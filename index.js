var fs = require("fs");
var jade = require("jade");
var path = require("path");
var url = require("url");

var jadePattern = new RegExp("^[/][/]--\\s*(\\S+)[.]jade$", "mg");

function compileTemplates(templates, dirPath, jadeOptions) {
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

  if (!templates) {
    templates = {};
  }

  files.forEach(function(file) {
    var view = file.substr(0, file.indexOf("."));
    var filePath = path.join(dirPath, file);
    var fileContents = fs.readFileSync(filePath, "utf8").toString();
    var parts = fileContents.split(jadePattern);

    parts.unshift(view);

    jadeOptions.filename = filePath;
    if (i > 0) {
      jadeOptions.filename += " [" + parts[i] + "]";
    }

    for (var i = 0; i < parts.length; i += 2) {
      templates[parts[i]] = jade.compile(parts[i+1], jadeOptions);
    }
  });

  // Compile all the subdirectories.

  var emptyFunction = function() { return ""; };

  dirs.forEach(function(dir) {
    if (!templates[dir]) {
      templates[dir] = emptyFunction;
    }
    compileTemplates(templates[dir], path.join(dirPath, dir), jadeOptions);
  });

  return templates;
}

function formatTemplates(templates, rootKeyPath) {
  body = "";

  for (key in templates) {
    if (templates.hasOwnProperty(key)) {
      var keyPath = rootKeyPath + "." + key;

      body += keyPath + " = " + templates[key].toString() + ";\n";
      body += formatTemplates(templates[key], keyPath);
    }
  }

  return body;

}

function urlPathKeys(urlPath, rootUrlPath) {
  if (urlPath.lastIndexOf(rootUrlPath) !== 0) {
    return [];
  }

  urlPath = urlPath.substr(rootUrlPath.length);

  if (urlPath.substr(urlPath.length - 3) === ".js") {
    urlPath = urlPath.substr(0, (urlPath.length - 3));
  }

  return urlPath.split("/").filter(function(str) { return str.length > 0; });
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

  if (rootDirPath.indexOf("/") != 0) {
    rootDirPath = rootDirPath + "/";
  }

  if (rootUrlPath.indexOf("/") != 0) {
    rootUrlPath = "/" + rootUrlPath;
  }
  if (rootUrlPath.lastIndexOf("/") != (rootUrlPath.length - 1)) {
    rootUrlPath = rootUrlPath + "/";
  }

  if (extraJadeOptions) {
    for (var key in extraJadeOptions) {
      if (extraJadeOptions.hasOwnProperty(key)) {
        jadeOptions[key] = extraJadeOptions[key];
      }
    }
  } 

  var templates = compileTemplates(null, rootDirPath, jadeOptions);

  var runtimePath = path.join(__dirname, "node_modules", "jade", "runtime.js");
  var runtime = fs.readFileSync(runtimePath, "utf8").toString();

  return function(req, res, next) {
    if (["GET", "HEAD"].indexOf(req.method) == -1) {
      return next();
    }

    var subTemplates = templates;
    var keys = urlPathKeys(url.parse(req.url).path, rootUrlPath);

    if (keys.length == 0) {
      return next();
    }

    for (var i = 0; i < keys.length; ++i) {
      subTemplates = subTemplates[keys[i]];
      if (!subTemplates) {
        return next();
      }
    }

    var body = runtime
      + "\nif (typeof(Templates) === \"undefined\") Templates = {};\n"
      + formatTemplates(subTemplates, "Templates");

    res.set("Content-Type", "application/javascript");
    res.send(body);
  };
};
