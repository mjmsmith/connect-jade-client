"use strict";

var fs = require("fs");
var jade = require("jade");
var mkdirp = require("mkdirp");
var path = require("path");
var url = require("url");

var jadePattern = new RegExp("^[/][/]--\\s*(\\S+)[.]jade$", "mg");

function setTemplateTimestamp(template, timestamp) {
  do {
    template.__timestamp__ = timestamp;
    template = template.__parent__;
  } while (template !== null && template.__timestamp__ < timestamp);
}

function compileTemplatesInFile(parent, filePath, jadeOptions) {
  var view = path.basename(filePath, ".jade");
  var fileContents = fs.readFileSync(filePath, "utf8").toString();
  var parts = fileContents.split(jadePattern);

  jadeOptions.filename = filePath;
  parent[view] = jade.compile(parts.shift(), jadeOptions);
  parent[view].__parent__ = parent;
  setTemplateTimestamp(parent[view], fs.statSync(filePath).mtime.getTime());

  for (var i = 0; i < parts.length; i += 2) {
    var subView = parts[i];

    jadeOptions.filename = filePath +" [" + subView + "]";
    parent[view][subView] = jade.compile(parts[i+1], jadeOptions);
    parent[view][subView].__parent__ = parent[view];
    parent[view][subView].__timestamp__ = null;
  }
}

function compileTemplatesInDir(parent, dirPath, jadeOptions) {
  // Get the .jade files and subdirectories in this directory.

  var files = [];
  var dirs = [];

  fs.readdirSync(dirPath).filter(function(item) {
    var stats = fs.statSync(path.join(dirPath, item));

    if (stats.isFile()) {
      if (item.substr(-5) === ".jade") {
        files.push(item);
      }
    }
    else if (stats.isDirectory()) {
      dirs.push(item);
    }
  });

  // Compile all the .jade files first in case we have a directory with the same name.

  files.forEach(function(file) {
    compileTemplatesInFile(parent, path.join(dirPath, file), jadeOptions);
  });

  // Compile all the subdirectories.

  dirs.forEach(function(dir) {
    if (!parent[dir]) {
      parent[dir] = function() { return ""; };
      parent[dir].__parent__ = parent;
      parent[dir].__timestamp__ = 0;
    }
    compileTemplatesInDir(parent[dir], path.join(dirPath, dir), jadeOptions);
  });
}

function jsTemplates(templates, rootKeyPath) {
  var body = "";

  for (var key in templates) {
    if (templates.hasOwnProperty(key) && ["__parent__", "__timestamp__"].indexOf(key) === -1) {
      var keyPath = rootKeyPath + "." + key;

      body += keyPath + " = " + templates[key].toString() + ";\n";
      body += jsTemplates(templates[key], keyPath);
    }
  }

  return body;
}

function jsRuntime() {
  return  "var jade = {};\n" +
          "(function(exports) {\n" +
          fs.readFileSync(path.join(__dirname, "runtime.js"), "utf8").toString() +
          "})(jade);\n";
}

function jsPrefix() {
  return "\nvar T = {};\n";
}

function jsSuffix(templatesVarName) {
  return "typeof(module) === 'object' && typeof(module.exports) === 'object' " +
         "? module.exports." + templatesVarName + " = T " +
         ": window." + templatesVarName + " = T;\n";
}

function normalizeOptions(inputOptions) {
  var options = {
    templatesVarName: inputOptions.templatesVarName,
    rootSrcPath: inputOptions.rootSrcPath,
    rootDstPath: inputOptions.rootDstPath,
    rootUrlPath: inputOptions.rootUrlPath
  };

  if (!options.templatesVarName) {
    options.templatesVarName = "Templates";
  }

  if (options.rootSrcPath.lastIndexOf(path.sep) === (options.rootSrcPath.length - 1)) {
    options.rootSrcPath = options.rootSrcPath.substr(0, (options.rootSrcPath.length - 1));
  }

  if (options.rootDstPath.lastIndexOf(path.sep) === (options.rootDstPath.length - 1)) {
    options.rootDstPath = options.rootSrcPath.substr(0, (options.rootDstPath.length - 1));
  }

  if (options.rootUrlPath.indexOf("/") !== 0) {
    options.rootUrlPath = "/" + options.rootUrlPath;
  }
  if (options.rootUrlPath.lastIndexOf("/") === (options.rootUrlPath.length - 1)) {
    options.rootUrlPath = options.rootUrlPath.substr(0, (options.rootUrlPath.length - 1));
  }

  return options;
}

function normalizeJadeOptions(inputJadeOptions) {
  var jadeOptions = {
    client: true,
    compileDebug: false,
    debug: false,
    pretty: true
  };

  if (inputJadeOptions) {
    for (var key in inputJadeOptions) {
      if (inputJadeOptions.hasOwnProperty(key)) {
        jadeOptions[key] = inputJadeOptions[key];
      }
    }
  }

  return jadeOptions;
}

module.exports = function(inputOptions, inputJadeOptions) {
  var options = normalizeOptions(inputOptions);
  var jadeOptions = normalizeJadeOptions(inputJadeOptions);
  var keysPattern = new RegExp("^.{"+options.rootUrlPath.length+"}(/.+)?[.]js$");
  var runtime = jsRuntime();
  var templates = {};

  compileTemplatesInDir(templates, options.rootSrcPath, jadeOptions);

  return function(req, res, next) {
    if (["GET", "HEAD"].indexOf(req.method) == -1) {
      return next();
    }

    var urlPath = url.parse(req.url).path;

    if (urlPath.lastIndexOf(options.rootUrlPath) !== 0) {
      return next();
    }

    var match = keysPattern.exec(urlPath);

    if (match === null) {
      return next();
    }

    var keys = (match[1] || "").split("/").filter(function(str) { return str.length > 0; });
    var subTemplates = templates;

    for (var i = 0; i < keys.length; ++i) {
      subTemplates = subTemplates[keys[i]];
      if (!subTemplates) {
        return next();
      }
    }

    var jsBody = "(function() {\n" +
                 runtime +
                 jsPrefix() +
                 jsTemplates(subTemplates, "T") +
                 jsSuffix(options.templatesVarName) +
                 "})();";
    var jsPath = options.rootDstPath +
                 options.rootUrlPath.replace("/", path.sep) +
                 (keys.length > 0 ? (path.sep + keys.join(path.sep)) : "") +
                 ".js";

    mkdirp(path.dirname(jsPath), 0x1ED, function(err) {
      if (err) {
        return next(err);
      }
      return fs.writeFile(jsPath, jsBody, "utf8", next);
    });
  };
};
