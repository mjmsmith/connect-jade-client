"use strict";

var fs = require("fs");
var jade = require("jade");
var mkdirp = require("mkdirp");
var path = require("path");
var url = require("url");

var jadePattern = new RegExp("^[/][/]--\\s*(\\S+)[.]jade$", "mg");
var moduleName = path.basename(path.dirname(module.filename));

module.exports = function(inputOptions, inputJadeOptions) {
  var options = normalizeOptions(inputOptions);
  var jadeOptions = normalizeJadeOptions(inputJadeOptions);
  var keysPattern = new RegExp("^.{"+options.prefix.length+"}(/.+)?[.]js$");
  var jadeRuntime = fs.readFileSync(path.join(__dirname, "runtime.js"), "utf8").toString();
  var rootTemplateNode = compileTemplates(options.source, jadeOptions);

  return function(req, res, next) {
    // Check method.

    if (["GET", "HEAD"].indexOf(req.method) === -1) {
      return next();
    }

    // Check that the url path begins with our root path.

    var urlPath = url.parse(req.url).path;

    if (urlPath.lastIndexOf(options.prefix) !== 0) {
      return next();
    }

    // Reload templates if option is set.

    if (options.reload) {
      rootTemplateNode = compileTemplates(options.source, jadeOptions);
    }

    // Get the template node matching this url path.

    var match = keysPattern.exec(urlPath);

    if (match === null) {
      return next();
    }

    var keys = (match[1] || "").split("/").filter(function(str) { return str.length > 0; });
    var templateNode = rootTemplateNode;

    for (var i = 0; i < keys.length; ++i) {
      templateNode = templateNode[keys[i]];
      if (!templateNode) {
        return next();
      }
    }

    // This is one of our paths.  Check the existing file timestamp (if any).

    var jsPath = options.public +
                 options.prefix.replace("/", path.sep) +
                 (keys.length > 0 ? (path.sep + keys.join(path.sep)) : "") +
                 ".js";

    fs.stat(jsPath, function(err, stats) {
      // Error code other than ENOENT means something went wrong,

      if (err && err.code !== "ENOENT") {
        return next(err);
      }

      // No error and newer file timestamp means we can just serve the existing file.

      if (!err && templateNode.__timestamp__ <= stats.mtime.getTime()) {
        return next();
      }

      // We have to (re-)create the file so make sure the directory exists.

      mkdirp(path.dirname(jsPath), 0x1ED, function(err) {
        if (err) {
          return next(err);
        }

        // Write the file.

        fs.writeFile(jsPath, jsBody(jadeRuntime, templateNode, options.global), "utf8", function(err) {
          if (err) {
            return next(err);
          }

          // And now we can serve the new/updated file.

          console.log(moduleName + " wrote " + jsPath);
          return next();
        });
      });
    });
  };
};

function compileTemplates(sourcePath, jadeOptions) {
  var templateNode = createTemplateNode(function() { return ""; }, null, 0);

  console.log(moduleName + " compiling " + sourcePath);
  compileTemplatesInDir(templateNode, sourcePath, jadeOptions);

  return templateNode;
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
    parent[view][subView] = createTemplateNode(jade.compile(parts[i+1], jadeOptions), parent[view], null);
  }
}

function createTemplateNode(func, parent, timestamp) {
  func.__parent__ = parent;

  if (timestamp !== null) {
    updateTemplateNodeTimestamp(func, timestamp);
  }
  else {
    Object.defineProperty(func, "__timestamp__", {
      get: function() { return this.__parent__.__timestamp__; }
    });
  }

  return func;
}

function updateTemplateNodeTimestamp(templateNode, timestamp) {
  do {
    templateNode.__timestamp__ = timestamp;
    templateNode = templateNode.__parent__;
  } while (templateNode !== null && templateNode.__timestamp__ < timestamp);
}

function jsBody(jadeRuntime, templateNode, global) {
  return "(function() {\n" +
           "var jade = {};\n" +
           "(function(exports) {\n" +
             jadeRuntime +
           "})(jade);\n\n" +
           jsTemplateNode(templateNode, "T") +
           "typeof(module) === 'object' && typeof(module.exports) === 'object' " +
           "? module.exports." + global + " = T : window." + global + " = T;\n" +
         "})();";
}

function jsTemplateNode(templateNode, keyPath) {
  var body = keyPath + " = " + templateNode.toString() + ";\n";

  for (var key in templateNode) {
    if (templateNode.hasOwnProperty(key) && ["__parent__", "__timestamp__"].indexOf(key) === -1) {
      body += jsTemplateNode(templateNode[key], (keyPath + "." + key));
    }
  }

  return body;
}

function normalizeOptions(inputOptions) {
  var options = {
    source: inputOptions.source,
    public: inputOptions.public,
    prefix: inputOptions.prefix,
    global: inputOptions.global,
    reload: !!inputOptions.reload
  };

  if (typeof(options.source) !== "string") {
    abort("invalid 'source' setting");
  }
  if (options.source.lastIndexOf(path.sep) === (options.source.length - 1)) {
    options.source = options.source.substr(0, (options.source.length - 1));
  }

  if (typeof(options.public) !== "string") {
    abort("invalid 'public' setting");
  }
  if (options.public.lastIndexOf(path.sep) === (options.public.length - 1)) {
    options.public = options.public.substr(0, (options.public.length - 1));
  }

  if (typeof(options.prefix) !== "string") {
    abort("invalid 'prefix' setting");
  }
  if (options.prefix.indexOf("/") !== 0) {
    options.prefix = "/" + options.prefix;
  }
  if (options.prefix.lastIndexOf("/") === (options.prefix.length - 1)) {
    options.prefix = options.prefix.substr(0, (options.prefix.length - 1));
  }

  if (options.global) {
    if (typeof(options.global) !== "string") {
      abort("invalid 'global' setting");
    }
  }
  else {
    options.global = "Templates";
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
    if (typeof(inputJadeOptions) !== "object") {
      abort("invalid 'jadeOptions' setting");
    }

    for (var key in inputJadeOptions) {
      if (inputJadeOptions.hasOwnProperty(key)) {
        jadeOptions[key] = inputJadeOptions[key];
      }
    }
  }

  return jadeOptions;
}

function abort(reason) {
  throw new Error(moduleName + ": " + reason);
}
