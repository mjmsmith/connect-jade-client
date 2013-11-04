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

function preambleJS() {
  return ";\nif (typeof(Templates) === \"undefined\") Templates = {};\n";
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

module.exports = function(options, extraJadeOptions) {
  var rootDirPath = options.rootDirPath;
  var rootUrlPath = options.rootUrlPath;
  var jadeOptions = {
    client: true,
    compileDebug: false,
    debug: false,
    pretty: true
  };

  if (rootDirPath.indexOf(path.sep) !== 0) {
    rootDirPath = rootDirPath + path.sep;
  }

  if (rootUrlPath.indexOf(path.sep) !== 0) {
    rootUrlPath = path.sep + rootUrlPath;
  }
  if (rootUrlPath.lastIndexOf(path.sep) !== (rootUrlPath.length - 1)) {
    rootUrlPath = rootUrlPath + path.sep;
  }

  if (extraJadeOptions) {
    for (var key in extraJadeOptions) {
      if (extraJadeOptions.hasOwnProperty(key)) {
        jadeOptions[key] = extraJadeOptions[key];
      }
    }
  }

  var templates = compileTemplatesInDir(null, rootDirPath, jadeOptions);

  var runtimePath = path.join(__dirname, "..", "jade", "runtime.js");
  var runtime = fs.readFileSync(runtimePath, "utf8").toString();

  return function(req, res, next) {
    if (["GET", "HEAD"].indexOf(req.method) == -1) {
      return next();
    }

    var urlPath = url.parse(req.url).path;

    if (urlPath.lastIndexOf(rootUrlPath) !== 0) {
      return next();
    }

    urlPath = urlPath.substr(rootUrlPath.length);

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
    res.send(runtime + preambleJS() + templatesJS(subTemplates, "Templates"));
  };
};
