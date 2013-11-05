"use strict";

var fs = require("fs");
var jade = require("jade");
var path = require("path");
var url = require("url");

var jadePattern = new RegExp("^[/][/]--\\s*(\\S+)[.]jade$", "mg");
var emptyFunction = function() { return ""; };

function compileTemplatesInFile(templates, filePath, jadeOptions) {
  var view = path.basename(filePath, ".jade");
  var fileContents = fs.readFileSync(filePath, "utf8").toString();
  var parts = fileContents.split(jadePattern);

  jadeOptions.filename = filePath;
  templates[view] = jade.compile(parts[0], jadeOptions);
  parts.shift();

  for (var i = 0; i < parts.length; i += 2) {
    jadeOptions.filename = filePath +" [" + parts[i] + "]";
    templates[view+"."+parts[i]] = jade.compile(parts[i+1], jadeOptions);
  }
}

function compileTemplatesInDir(templates, dirPath, jadeOptions) {
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

  if (!templates) {
    templates = {};
  }

  // Compile all the .jade files first in case we have a directory with the same name.

  files.forEach(function(file) {
    compileTemplatesInFile(templates, path.join(dirPath, file), jadeOptions);
  });

  // Compile all the subdirectories.

  dirs.forEach(function(dir) {
    if (!templates[dir]) {
      templates[dir] = emptyFunction;
    }
    compileTemplatesInDir(templates[dir], path.join(dirPath, dir), jadeOptions);
  });

  return templates;
}

function prefixJS() {
  return "\nvar T = {};\n";
}

function templatesJS(templates, rootKeyPath) {
  var body = "";

  for (var key in templates) {
    if (templates.hasOwnProperty(key)) {
      var keyPath = rootKeyPath + "." + key;

      body += keyPath + " = " + templates[key].toString() + ";\n";
      body += templatesJS(templates[key], keyPath);
    }
  }

  return body;
}

function suffixJS(templatesVarName) {
  return "typeof(module) === 'object' && typeof(module.exports) === 'object' " +
         "? module.exports." + templatesVarName + " = T " +
         ": window." + templatesVarName + " = T;\n";
}

function normalizeOptions(inputOptions) {
  var options = {
    templatesVarName: inputOptions.templatesVarName,
    rootDirPath: inputOptions.rootDirPath,
    rootUrlPath: inputOptions.rootUrlPath
  };

  if (!options.templatesVarName) {
    options.templatesVarName = "Templates";
  }

  if (options.rootDirPath.indexOf(path.sep) !== 0) {
    options.rootDirPath = options.rootDirPath + path.sep;
  }

  if (options.rootUrlPath.indexOf(path.sep) !== 0) {
    options.rootUrlPath = path.sep + options.rootUrlPath;
  }
  if (options.rootUrlPath.lastIndexOf(path.sep) !== (options.rootUrlPath.length - 1)) {
    options.rootUrlPath = options.rootUrlPath + path.sep;
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
  var templates = compileTemplatesInDir(null, options.rootDirPath, jadeOptions);
  var runtime = "var jade = {};\n" +
                "(function(exports) {\n" +
                fs.readFileSync(path.join(__dirname, "runtime.js"), "utf8").toString() +
                "})(jade);\n";

  return function(req, res, next) {
    if (["GET", "HEAD"].indexOf(req.method) == -1) {
      return next();
    }

    var urlPath = url.parse(req.url).path;

    if (urlPath.lastIndexOf(options.rootUrlPath) !== 0) {
      return next();
    }

    urlPath = urlPath.substr(options.rootUrlPath.length);

    if (urlPath.substr(urlPath.length - 3) === ".js") {
      urlPath = urlPath.substr(0, (urlPath.length - 3));
    }

    var keys = urlPath.split("/").filter(function(str) { return str.length > 0; });
    var subTemplates = templates;

    for (var i = 0; i < keys.length; ++i) {
      subTemplates = subTemplates[keys[i]];
      if (!subTemplates) {
        return next();
      }
    }

    res.set("Content-Type", "application/javascript");
    res.send("(function() {\n" +
             runtime +
             prefixJS() +
             templatesJS(subTemplates, "T") +
             suffixJS(options.templatesVarName) +
             "})();");
  };
};
