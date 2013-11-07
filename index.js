"use strict";

var fs = require("fs");
var jade = require("jade");
var mkdirp = require("mkdirp");
var path = require("path");
var url = require("url");

var jadePattern = new RegExp("^[/][/]--\\s*(\\S+)[.]jade$", "mg");

function updateTemplateNodeTimestamp(template, timestamp) {
  do {
    template.__timestamp__ = timestamp;
    template = template.__parent__;
  } while (template !== null && template.__timestamp__ < timestamp);
}

function createTemplateNode(func, parent, timestamp) {
  func.__parent__ = parent;
  updateTemplateNodeTimestamp(func, timestamp);

  return func;
}

function compileTemplatesInFile(parent, filePath, jadeOptions) {
  var view = path.basename(filePath, ".jade");
  var fileContents = fs.readFileSync(filePath, "utf8").toString();
  var parts = fileContents.split(jadePattern);

  jadeOptions.filename = filePath;
  parent[view] = createTemplateNode(jade.compile(parts.shift(), jadeOptions),
                                    parent,
                                    fs.statSync(filePath).mtime.getTime());

  for (var i = 0; i < parts.length; i += 2) {
    var subView = parts[i];

    jadeOptions.filename = filePath +" [" + subView + "]";
    // TODO make timestamp a property than returns the parent's timestamp
    parent[view][subView] = createTemplateNode(jade.compile(parts[i+1], jadeOptions), parent[view], null);
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
      parent[dir] = createTemplateNode(function() { return ""; }, parent, 0);
    }
    compileTemplatesInDir(parent[dir], path.join(dirPath, dir), jadeOptions);
  });
}

function compileTemplates(rootSrcPath, jadeOptions) {
  console.log("compiling templates");
  var templates = {};

  compileTemplatesInDir(templates, rootSrcPath, jadeOptions);

  return templates;
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

function jsBody(runtime, templates, templatesVarName) {
  return "(function() {\n" +
           runtime +
           "\nvar T = {};\n" +
           jsTemplates(templates, "T") +
           "\ntypeof(module) === 'object' && typeof(module.exports) === 'object' " +
             "? module.exports." + templatesVarName + " = T : window." + templatesVarName + " = T;\n" +
         "})();";

}

function normalizeOptions(inputOptions) {
  var options = {
    templatesVarName: inputOptions.templatesVarName,
    rootSrcPath: inputOptions.rootSrcPath,
    rootDstPath: inputOptions.rootDstPath,
    rootUrlPath: inputOptions.rootUrlPath,
    reload: !!inputOptions.reload
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
  var templates = compileTemplates(options.rootSrcPath, jadeOptions);

  return function(req, res, next) {
    // Check method.

    if (["GET", "HEAD"].indexOf(req.method) == -1) {
      return next();
    }

    // Check that the url path begins with our root path.

    var urlPath = url.parse(req.url).path;

    if (urlPath.lastIndexOf(options.rootUrlPath) !== 0) {
      return next();
    }

    // Reload templates if option is set.

    if (options.reload) {
      templates = compileTemplates(options.rootSrcPath, jadeOptions);
    }

    // Get the parent templates node matching this url path.

    var match = keysPattern.exec(urlPath);

    if (match === null) {
      return next();
    }

    var keys = (match[1] || "").split("/").filter(function(str) { return str.length > 0; });
    var parent = templates;

    for (var i = 0; i < keys.length; ++i) {
      parent = parent[keys[i]];
      if (!parent) {
        return next();
      }
    }

    // This is one of our paths.  Check the existing file timestamp (if any).

    var jsPath = options.rootDstPath +
                 options.rootUrlPath.replace("/", path.sep) +
                 (keys.length > 0 ? (path.sep + keys.join(path.sep)) : "") +
                 ".js";

    fs.stat(jsPath, function(err, stats) {
      // Error code other than ENOENT means something went wrong,

      if (err && err.code !== "ENOENT") {
        return next(err);
      }

      // No error and newer file timestamp means we can just serve the existing file.

console.log("PARENT" + parent.__timestamp__/1000 + " FILE " + stats.mtime.getTime()/1000);

      if (!err && parent.__timestamp__ <= stats.mtime.getTime()) {
        return next();
      }

      // We have to (re-)create the file so make sure the directory exists.

      mkdirp(path.dirname(jsPath), 0x1ED, function(err) {
        if (err) {
          return next(err);
        }

        // Write the file.

        fs.writeFile(jsPath, jsBody(runtime, parent, options.templatesVarName), "utf8", function(err) {
          if (err) {
            return next(err);
          }

          // And now we can serve the new/updated file.

          console.log("wrote " + jsPath);
          return next();
        });
      });
    });
  };
};
