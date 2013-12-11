# connect-jade-client

__connect-jade-client__ is Connect middleware for serving compiled Jade templates to clients with maximum flexibility and minimum hassle.

## Installation

Install via npm:

```
npm install connect-jade-client
```

## Required Settings

At a minimum, three settings must be provided to the middleware:

```
var connectJadeClient = require("connect-jade-client");
...
app.use(connectJadeClient({
    source: "/full/path/to/your/client/jade/directory",
    public: "/full/path/to/your/site/public/directory",
    prefix: "/url/prefix/for/client/views"
}));
```

In other words,

* `source` is the root directory for your client-side Jade template files,
* `public` is the root directory for your site's public files, and
* `prefix` is the path under `public` that identifies a relevant request.

## Details

Assume we have this example site structure.

```
/usr/local/mysite/
    index.js
    client/
        views/
            FirstView.jade
            SecondView.jade
            SecondView/
                DateView.jade
                TimeView.jade
            ThirdView.jade
    public/
    ...
```

#### Configuration

The connect-jade-client middleware is configured in `index.js` like so:

```
app.use(connectJadeClient({
    source: path.join(__dirname, "client", "views"),
    public: path.join(__dirname, "public"),
    prefix: "/js/views"
}));
```

#### Compilation

On startup, the middleware searches for all file ending in "__.jade__" under the `source` root directory.  It compiles all of the files into a hash table of function objects, where the key names correspond to the source structure.  In the example, the resulting table looks like this:

```
    FirstView:    function(args) {...}
    SecondView:   function(args) {...}
        DateView: function(args) {...}
        TimeView: function(args) {...}
    ThirdView:    function(args) {...}
}
```

The value associated with each key is the compiled template function. 

Note that to match the source structure, `SecondView` also defines the `DateView` and `TimeView` functions as properties.  This namespacing is supported to an arbitrary depth.

#### Request / Response

The middleware looks for incoming HTTP requests where the path begins with the `prefix` setting and ends in "__.js__".  It generates a JavaScript response that creates a hash table of the compiled templates on the client.  In the example, the generated file/response for `http://mysite.com/js/views.js` looks like this:

```
var T = {};
T.FirstView = function(args) {...};
T.SecondView = function(args) {...};
T.SecondView.DateView = function(args) {...};
T.SecondView.TimeView = function(args) {...};
T.ThirdView = function(args) {...};
window.Templates = T;
```
#### Example Use

Assume that the contents of the __SecondView__ files are as follows:

* SecondView.jade:

```
div Date and Time
```

* SecondView/DateView.jade
  
```
.date The date is #{date}.
```
  
* SecondView/TimeView.jade

```
.time The time is #{time}.
```

These (rather contrived) templates could be used in a (similarly contrived) Backbone View like this:

```
var DateView = Backbone.View.extend({
    render: function() {
        this.$el.html(Templates.SecondView.DateView(date: moment().format("MMM Do YY")));
        return this;
    }
});

var TimeView = Backbone.View.extend({
    render: function() {
        this.$el.html(Templates.SecondView.TimeView(time: moment().format("hh:mm:ss")));
        return this;
    }
});
  
var SecondView = Backbone.View.extend({
    render: function() {
        this.$el.append(new DateView().render());
        this.$el.append(new TimeView().render());
        return this;
     }
});
```

#### Multiple Apps

Because you can request any subset of templates using the corresponding path, it's easy to support multiple client-side apps.  Given a `source` structure like this:

```
/usr/local/mysite/
    client/
        views/
            FirstApp/
                FooView.jade
            SecondApp/
                BarView.jade
            ThirdApp/
                BazView.jade
    ...
```

The subset of templates corresponding to each app can be requested with the URLs:

```
http://mysite.com/js/views/FirstApp.js
http://mysite.com/js/views/SecondApp.js
http://mysite.com/js/views/ThirdApp.js
```

Similarly, the template(s) for a single view could be requested with the URL:

```
http://mysite.com/js/views/FirstApp/FooView.js
```

#### Alternate Template Format

In the example, sub-templates of the __SecondView__ template are stored in a corresponding subdirectory.  The middleware also supports a custom format where all templates are stored in the same file, with comments used to identify the sections.  The comment format is:

```
//-- TemplateName.jade
```

Note that the comment must begin with the string `//--` followed by at least one space, and end with the string `.jade`.  All text up to the first identifier comment is the template associated with the name of the file itself; all text following an identifier comment is the template associated with the filename specified in the comment.  Only one level of nesting is supported.

In the example, the templates in the __SecondView__ subdirectory could instead be included in __SecondView.jade__ as follows:

```
div Date and Time

//-- DateView.jade
  
.date The date is #{date}.
  
//-- TimeView.jade

.time The time is #{time}.
```

## Optional Settings

* `global` The name of the client-side public variable. (string)
   
  default: __Templates__
  
Include the `global` setting to specify an alternate name for the templates variable.

* `jadeOptions` Options passed to the Jade compiler. (object)

  default: __{ client: true, compileDebug: false, debug: false, pretty: true }__

Any options you specify will be merged into the default options.

* `reload` Search for and recompile  templates on every request. (boolean)

  default: __false__

By default, the middleware will only generate a new JavaScript file if it doesn't exist, or if the file date is earlier than any of the source __.jade__ files it references.  This means that during development, it won't pick up changes to __.jade__ files made after the middleware was initialized.  Set the `reload` setting to `true` to have it rebuild the templates on every request.

```
  reload: (process.env.NODE_ENV === "development")
```
