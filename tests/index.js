var connectJadeClient = require("../../connect-jade-client");
var express = require("express");
var fs = require("fs");
var mocha = require("mocha");
var path = require("path");
var request = require("supertest");

var copyDirSyncRecursive = require("wrench").copyDirSyncRecursive;
var rmdirSyncRecursive = require("rimraf").sync;

var fixturesPath = path.join(__dirname, "fixtures");
var viewsPath = path.join(__dirname, "views");
var publicPath = path.join(__dirname, "public");

describe("templates", function() {
  before(function() {
    rmdirSyncRecursive(viewsPath);
    rmdirSyncRecursive(publicPath);
    copyDirSyncRecursive(fixturesPath, viewsPath);
    fs.mkdirSync(publicPath);

    app = express();
    app.use(connectJadeClient({
      source: viewsPath,
      public: publicPath,
      prefix: "/views",
      global: "Templates",
      reload: false
    }));
    app.use(express.static(publicPath));
  });

  it("single should return a top-level template", function(done) {
    request(app)
    .get("/views/single.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  it("multiple should return a top-level template and subtemplates", function(done) {
    request(app)
    .get("/views/multiple.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T = function anonymous[(]locals[)]/)
    .expect(/T.First = function anonymous[(]locals[)]/)
    .expect(/T.Second = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  it("directory should return multiple levels of subtemplates", function(done) {
    request(app)
    .get("/views/directory.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T.foo = function anonymous[(]locals[)]/)
    .expect(/T.bar = function anonymous[(]locals[)]/)
    .expect(/T.subdirectory.baz = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  it("both should return a file template and multiple levels of subtemplates", function(done) {
    request(app)
    .get("/views/both.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T.directory = function anonymous[(]locals[)]/)
    .expect(/T.directory.foo = function anonymous[(]locals[)]/)
    .expect(/T.directory.bar = function anonymous[(]locals[)]/)
    .expect(/T.directory.subdirectory.baz = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  after(function() {
    rmdirSyncRecursive(viewsPath);
    rmdirSyncRecursive(publicPath);
  });
});

describe("reload default false", function() {
  before(function() {
    rmdirSyncRecursive(viewsPath);
    rmdirSyncRecursive(publicPath);
    copyDirSyncRecursive(fixturesPath, viewsPath);
    fs.mkdirSync(publicPath);

    app = express();
    app.use(connectJadeClient({
      source: viewsPath,
      public: publicPath,
      prefix: "/views",
      global: "Templates"
    }));
    app.use(express.static(publicPath));
  });

  it("multiple should return a First and Second subtemplate", function(done) {
    request(app)
    .get("/views/multiple.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T.First = function anonymous[(]locals[)]/)
    .expect(/T.Second = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  it("changes to multiple should be ignored", function(done) {
    fs.writeFileSync(path.join(viewsPath, "multiple.jade"), "junk");
    request(app)
    .get("/views/multiple.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T.First = function anonymous[(]locals[)]/)
    .expect(/T.Second = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  after(function() {
    rmdirSyncRecursive(viewsPath);
    rmdirSyncRecursive(publicPath);
  });
});

describe("reload true", function() {
  before(function() {
    rmdirSyncRecursive(viewsPath);
    rmdirSyncRecursive(publicPath);
    copyDirSyncRecursive(fixturesPath, viewsPath);
    fs.mkdirSync(publicPath);

    app = express();
    app.use(connectJadeClient({
      source: viewsPath,
      public: publicPath,
      prefix: "/views",
      global: "Templates",
      reload: true
    }));
    app.use(express.static(publicPath));
  });

  it("multiple should return a First and Second subtemplate", function(done) {
    request(app)
    .get("/views/multiple.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/T.First = function anonymous[(]locals[)]/)
    .expect(/T.Second = function anonymous[(]locals[)]/)
    .end(function(err, res) {
      done(err);
    });
  });

  it("changes to multiple should be loaded", function(done) {
    fs.writeFileSync(path.join(viewsPath, "multiple.jade"), "junk");
    request(app)
    .get("/views/multiple.js")
    .expect("Content-Type", /javascript/)
    .expect(200)
    .expect(/junk/)
    .end(function(err, res) {
      done(err);
    });
  });

  after(function() {
    rmdirSyncRecursive(viewsPath);
    rmdirSyncRecursive(publicPath);
  });
});
