'use strict'

const path = require('path')
const fs = require('fs')
const cachingFS = require('lasso-caching-fs')
const stripJsonComments = require('strip-json-comments')
const lassoPackageRoot = require('lasso-package-root')
const readOptions = { encoding: 'utf8' }

const UglifyES = require('uglify-es')
const csso = require('csso')

/*
 Sample Configuration

{
 babel: {
     enable: true || false,
     config: {
       extensions: ['.js', '.es6'],
       babelOptions: {
       }
     }
  },
  jsMinify: {
    enable: true || false,
    config: { }
  },
  cssMinify: {
    enable: true || false,
    config: { }
  }
}
*/

let babel

function getBabel () {
  if (!babel) {
    babel = require('babel-core')
  }
  return babel
}

function readAndParse (path) {
  return JSON.parse(stripJsonComments(fs.readFileSync(path, readOptions)))
}

module.exports = function (lasso, pluginConfig) {
  /*
   * Babel
   */
  // Is babel enabled?
  let babelEnabled = pluginConfig.babel ? pluginConfig.babel.enable : false
  // Grab our configuration for babel
  let babelConfig = pluginConfig.babel ? pluginConfig.babel.config || null : null
  // Babel extensions
  let babelExtensions = babelConfig ? babelConfig.extensions : ['.js', '.es6']

  babelExtensions = babelExtensions.reduce((lookup, ext) => {
    if (ext.charAt(0) !== '.') {
      ext = '.' + ext
    }
    lookup[ext] = true
    return lookup
  }, {})

  // Babel Transform
  lasso.addTransform({
    id: __filename,

    contentType: 'js',

    name: `${module.id}-babel`,

    stream: false,

    transform: function (code, lassoContext) {
      // Do nothing if not enabled
      if (!babelEnabled) {
        return code
      } else {
        let filename = lassoContext.filename

        if (!filename || !babelExtensions.hasOwnProperty(path.extname(filename))) {
          // This shouldn't be the case
          return code
        }

        let babelOptions = babelConfig.babelOptions

        let curDir = path.dirname(filename)
        let rootPackage = lassoPackageRoot.getRootPackage(path.dirname(filename))

        if (!babelOptions) {

          while (true) {
            let babelrcPath = path.join(curDir, '.babelrc')
            let babelrcBrowserPath = path.join(curDir, '.babelrc-browser')

            // First we check for a .babelrc-browser in the directory, if it
            // exists, we read it and break. If not, we do the same for a
            // .babelrc file. Otherwise, we fall back to looking for a
            // package.json in the same directory with a "babel" key.
            if (cachingFS.existsSync(babelrcBrowserPath)) {
              babelOptions = readAndParse(babelrcBrowserPath)
              break
            } else if (cachingFS.existsSync(babelrcPath)) {
              babelOptions = readAndParse(babelrcPath)
              break
            } else {
              let packagePath = path.join(curDir, 'package.json')
              if (cachingFS.existsSync(packagePath)) {
                let packageJson = readAndParse(packagePath)

                if (packageJson.babel) {
                  babelOptions = packageJson.babel
                  break
                }
              }
            }

            if (curDir === rootPackage.__dirname) {
              break
            } else {
              let parentDir = path.dirname(curDir)
              if (!parentDir || parentDir === curDir) {
                break
              }
              curDir = parentDir
            }
          }

          if (!babelOptions) {
            // No babel config... Don't do anything
            return code
          }
        }

        babelOptions.filename = path.relative(curDir, filename)
        babelOptions.babelrc = false
        let babel = getBabel()

        let result = babel.transform(code, babelOptions)
        return result.code
      }
    }
  })

  /*
   * Uglify-ES
   */
  // Is uglify enabled?
  let jsMinifyEnabled = pluginConfig.jsMinify ? pluginConfig.jsMinify.enable : false
  // Grab our configuration for babel
  let jsMinifyConfig = pluginConfig.jsMinify ? pluginConfig.jsMinify.config || null : null

  function minifyJS (src, options) {
    options = options || { compress: false, mangle: false }

    var result = UglifyES.minify(src, options)

    if (!result.error) {
      return result.code
    } else {
      throw result.error
    }
  }

  function isInline (lassoContext) {
    if (lassoContext.inline === true) {
      return true
    }

    if (lassoContext.dependency && lassoContext.dependency.inline === true) {
      return true
    }

    return false
  }

  lasso.addTransform({
    contentType: 'js',

    name: `${module.id}-uglify`,

    stream: false,

    transform: function (code, lassoContext) {
      if (!jsMinifyEnabled || (pluginConfig.inlineOnly === true && !isInline(lassoContext))) {
        // Skip minification if not enabled or when when we
        // are not minifying inline code
        return code
      }

      try {
        var minified = minifyJS(code, jsMinifyConfig)
        if (minified.length && !minified.endsWith(';')) {
          minified += ';'
        }
        return minified
      } catch (e) {
        if (e && e.line) {
          var dependency = lassoContext.dependency
          console.error(`
            Unable to minify the following code for ${dependency} at line ${e.line} column ${e.col}:
            ------------------------------------
            ${code}
            ------------------------------------`)
          return code
        } else {
          throw e
        }
      }
    }
  })

  /*
   * CSSO
   */
  // Is uglify enabled?
  let cssMinifyEnabled = pluginConfig.cssMinify ? pluginConfig.cssMinify.enable : false
  // Grab our configuration for babel
  let cssMinifyConfig = pluginConfig.cssMinify ? pluginConfig.cssMinify.config || null : null

  function minifyCSS (src, options) {
    if (!options) {
      options = {}
    }

    var result = csso.minify(src, options)

    return result
  }

  module.exports = function (lasso, pluginConfig) {
    lasso.addTransform({

      contentType: 'css',

      name: `${module.id}-csso`,

      stream: false,

      transform: function (code, lassoContext) {
        if (!cssMinifyEnabled || (pluginConfig.inlineOnly === true && !isInline(lassoContext))) {
          // Skip minification when we are not minifying inline code
          return code
        }

        var minified = minifyCSS(code, cssMinifyConfig)

        return minified
      }
    })
  }
}
