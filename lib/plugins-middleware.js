'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const url = require('url');
const uuid = require('uuid');
const _ = require('lodash');
const async = require('async');
const debug = require('debug')('gateway:main');
const logging = require('./logging')
const assert = require('assert');
const stats = require('./stats')
const OnDataTransform = require('./ondata-transform');
const configService = require('./config');
const empty_buffer = new Buffer(0);

/**
 * injects plugins into gateway
 * @param plugins
 * @returns {Function(req,res,cb)}
 */
module.exports = function(plugins) {
  const logger = logging.getLogger();

  return function(sourceRequest, sourceResponse, next) {
    const startTime = Date.now();
    const correlation_id = uuid.v1();
    logger.info({ req: sourceRequest, i: correlation_id }, 'sourceRequest');
    debug('sourceRequest', correlation_id, sourceRequest.method, sourceRequest.url);
    //process the requests
    async.series(
      //onrequest
      getPluginHooksForEvent(null, {
        plugins: plugins,
        sourceRequest: sourceRequest,
        sourceResponse: sourceResponse
      }),
      function(err) {
        if (_.isBoolean(err) && err) {
          return next(false);
        }
        if (err) {
          return next(err)
        }

        //create target request
        const targetRequest = getTargetRequest(sourceRequest, sourceResponse, plugins, startTime, correlation_id,
          //callback for when response is initiated
          (err, targetResponse) => {

            if (err) {
              return next(err);
            }
            const options = {
              start: startTime,
              correlation_id: correlation_id,
              plugins: plugins,
              sourceRequest: sourceRequest,
              sourceResponse: sourceResponse,
            };

            handleTargetResponse(targetRequest, targetResponse, options, function(err) {
              if (err) {
                next(err);
              }
              else {
                next();
              }
            })
          });

        //initiate request piping
        subscribeToSourceRequestEvents(plugins, sourceRequest, sourceResponse, targetRequest);
        targetRequest.on('close', function() {
          debug('sourceRequest close');
        });
      });
  }
};

/**
 * Create the target request
 * @param plugins
 * @param correlation_id
 * @param sourceRequest
 * @param sourceResponse
 * @param cb
 * @private
 */
function getTargetRequest(sourceRequest, sourceResponse, plugins, startTime, correlation_id, cb) {

  const logger = logging.getLogger();
  const config = configService.get();

  const proxy = sourceResponse.proxy;

  // try to pass through most of the original request headers unmodified
  const target_headers = _.clone(sourceRequest.headers);

  if (_configured(config, 'x-request-id')) {
    // https://devcenter.heroku.com/articles/http-request-id
    target_headers['x-request-id'] =
      config.uid + '.' + correlation_id.toString();
  }

  if (_configured(config, 'x-forwarded-proto')) {
    target_headers['x-forwarded-proto'] = sourceRequest.connection.encrypted ? 'https' : 'http';
  }

  if (_configured(config, 'x-forwarded-for')) {
    // append client address to the x-forwarded-for header
    var forwarded_for = target_headers['x-forwarded-for'] || '';
    if (forwarded_for.length > 0) {
      forwarded_for += ',';
    }
    forwarded_for += sourceRequest.socket.remoteAddress;
    target_headers['x-forwarded-for'] = forwarded_for;
  }

  var hostname = target_headers.host;
  if (hostname) { // might be missing (with an http-1.0 client for example)

    if (_configured(config, 'x-forwarded-host')) {
      // append host header to the x-forwarded-host header
      var forwarded_host = target_headers['x-forwarded-host'] || '';
      if (forwarded_host.length > 0) {
        forwarded_host += ',';
      }
      forwarded_host += hostname;
      target_headers['x-forwarded-host'] = forwarded_host;
    }

    const colon = hostname.indexOf(':');
    if (colon > 0) {
      hostname = hostname.substring(0, colon); // strip port if present
    }

    if (_configured(config, 'via')) {
      // append our hostname (but not the port), if present, to the via header
      var via = target_headers['via'] || '';
      if (via.length > 0) {
        via += ',';
      }
      via += sourceRequest.httpVersion + ' ' + hostname;
      target_headers['via'] = via;
    }

    // To avoid breaking backard compatibility, we need to remove the "Host" header unless explicitly told not to
    const resetHostHeader = config.headers && typeof config.headers.host !== 'undefined' ? config.headers.host : true;

    if (resetHostHeader === true) {
      delete target_headers.host;
    }

    if (target_headers['content-length']) {
      delete target_headers['content-length'];
    }
  }

  const httpLibrary = proxy.secure ? https : http;
  assert(httpLibrary.request, 'must have request method');

  const targetRequestOptions = {
    hostname: sourceRequest.targetHostname,
    port: proxy.parsedUrl.port,
    path: sourceRequest.targetPath,
    method: sourceRequest.method,
    headers: target_headers, // pass through the modified headers
    agent: proxy.agent
  };

  
  if(config.edgemicro.request_timeout) {
    targetRequestOptions.timeout = config.edgemicro.request_timeout * 1000;
  }

  const targetRequest = httpLibrary.request(targetRequestOptions,
    (targetResponse) => cb(null, targetResponse));

  targetRequest.on('error', function(err) {

    const logInfo = {
      m: targetRequestOptions.method,
      u: targetRequestOptions.path,
      h: targetRequestOptions.hostname + ':' + targetRequestOptions.port,
      i: correlation_id
    };
    logger.warn({ req: logInfo, d: Date.now() - startTime, i: correlation_id, err: err }, 'targetRequest error');
    debug('targetRequest error', correlation_id, err.stack);
    async.series(getPluginHooksForEvent('error', {
        plugins: plugins,
        sourceRequest: sourceRequest,
        sourceResponse: sourceResponse
      }),
      function(e) {
        if (e) {
          logger.error(e);
          cb(e);
        } else {
          sourceResponse.statusCode = 502; // Bad Gateway
          cb(err);
        }
      });
  });

  const logInfo = {
    m: targetRequestOptions.method,
    u: targetRequestOptions.path,
    h: targetRequestOptions.hostname + ':' + targetRequestOptions.port,
    i: correlation_id
  };
  // log target request options, minus agent
  logger.info(logInfo, 'targetRequest');

  debug('targetRequest', correlation_id, targetRequestOptions.method, targetRequestOptions.hostname, targetRequestOptions.port, targetRequestOptions.path);
  stats.incrementRequestCount();
  return targetRequest;
};

/**
 * Handle the plugin wiring and response piping
 * @param targetRequest
 * @param targetResponse
 * @param options {start, correlation_id, plugins, sourceRequest, sourceResponse,promises}
 * @param cb
 * @private
 */
function handleTargetResponse(targetRequest, targetResponse, options, cb) {
  const start = options.start;
  const correlation_id = options.correlation_id;
  var copyOfPluginsReversed = options.plugins.slice().reverse();
  const plugins = copyOfPluginsReversed;
  const sourceRequest = options.sourceRequest;
  const sourceResponse = options.sourceResponse;
  const logger = logging.getLogger();
  const config = configService.get();

  logger.info({ res: targetResponse, d: Date.now() - start, i: correlation_id }, 'targetResponse');
  debug('targetResponse', correlation_id, targetResponse.statusCode);
  async.series(
    //onresponse
    getPluginHooksForEvent(null, {
      plugins: plugins,
      sourceRequest: sourceRequest,
      sourceResponse: sourceResponse,
      targetRequest: targetRequest,
      targetResponse: targetResponse
    }),
    function(err, results) {
      err && logger.error(err);
      if (sourceResponse.finished || sourceResponse.headersSent) {
        logger.error("response finished before work can be done");
        return;
      }
      if (err) {
        return cb(err);
      }
      debug(results);
      stats.incrementStatusCount(targetResponse.statusCode);
      stats.incrementResponseCount();
      // the size of the body will change if any of the plugins transform the content
      // delete the response content-length to allow streaming.
      delete targetResponse.headers['content-length'];
      // propagate response headers from target to client
      Object.keys(targetResponse.headers).forEach(function(header) {
        // skip setting the 'connection: keep-alive' header
        // setting it causes gateway to not accept any more connections
        if (header !== 'connection') {
          sourceResponse.setHeader(header, targetResponse.headers[header]);
        }
      });
      sourceResponse.statusCode = targetResponse.statusCode;

      if (_configured(config, 'x-response-time')) {
        sourceResponse.setHeader('x-response-time', Date.now() - start);
      }
      _subscribeToResponseEvents(plugins, sourceRequest, sourceResponse, targetRequest, targetResponse, correlation_id, start,
        function(err, result) {
          cb(err, result)
        });
    });
};

/**
 * Properly set up request piping.
 * @param plugins
 * @param sourceRequest
 * @param sourceResponse
 * @param targetRequest
 * @private
 */
function subscribeToSourceRequestEvents(plugins, sourceRequest, sourceResponse, targetRequest) {
  const logger = logging.getLogger();

  const onend_request_handlers = async.seq.apply(this, getPluginHooksForEvent('end', {
    plugins: plugins,
    sourceRequest: sourceRequest,
    sourceResponse: sourceResponse,
  }));

  var ondata_request_transform = new OnDataTransform({
    pluginHooks: getPluginHooksForEvent('data', {
      plugins: plugins,
      sourceRequest: sourceRequest,
      sourceResponse: sourceResponse
    })
  })

  sourceRequest.on('end', ()=> {
    onend_request_handlers(empty_buffer,
      function(err, result) {
        err ? logger.error(err) : (result.length && targetRequest.write(result));
        return err;
      });
  });

  sourceRequest
    .pipe(ondata_request_transform)
    .pipe(targetRequest);
};

/**
 * Properly set up response piping.
 * @param plugins
 * @param sourceRequest
 * @param sourceResponse
 * @param targetRequest
 * @param targetResponse
 * @param correlation_id
 * @param start
 * @param cb
 * @private
 */
function _subscribeToResponseEvents(plugins, sourceRequest, sourceResponse, targetRequest, targetResponse, correlation_id, start, cb) {
  const logger = logging.getLogger();
  const onend_response_handlers = async.seq.apply(this, getPluginHooksForEvent('end', {
    plugins: plugins,
    sourceRequest: sourceRequest,
    sourceResponse: sourceResponse,
    targetRequest: targetRequest,
    targetResponse: targetResponse
  }));

  var ondata_response_transform = new OnDataTransform({
    pluginHooks: getPluginHooksForEvent('data', {
      plugins: plugins,
      sourceRequest: sourceRequest,
      sourceResponse: sourceResponse,
      targetRequest: targetRequest,
      targetResponse: targetResponse
    })
  });

  targetResponse.on('end', ()=> {
    onend_response_handlers(empty_buffer,
      function(err, result) {
        err ? logger.error(err) : (result.length && sourceResponse.write(result));
        cb(err, result);
      });
  });

  targetResponse
    .pipe(ondata_response_transform)
    .pipe(sourceResponse);

  targetResponse.on('close', function() {
    debug('targetResponse close', correlation_id);
    logger.info({ res: sourceResponse, d: Date.now() - start, i: correlation_id }, 'res close');
  });

  targetResponse.on('error', function(err) {
    logger.warn({
      res: targetResponse,
      d: Date.now() - start,
      i: correlation_id,
      err: err
    }, 'targetResponse error');

    debug('targetResponse error', correlation_id, err.stack);
    async.series(getPluginHooksForEvent('error', {
        plugins: plugins,
        sourceRequest: sourceRequest,
        sourceResponse: sourceResponse,
        targetRequest: targetRequest,
        targetResponse: targetResponse
      }),
      function(err) {
        cb(err)
      });
  });
}

const getPluginHooksForEvent = function(type, options) {
  const plugins = options.plugins;
  const pluginMap = plugins.map((plugin) => getPluginHookForEvent(plugin, type, options));
  return pluginMap;
};

function getPluginHookForEvent(plugin, type, options) {
  const isRequest = !options.targetRequest;
  const logger = logging.getLogger();
  //return handler
  return (data, cb) => {
    cb = _.isFunction(data) ? data : cb;
    data = _.isFunction(data) ? null : data;
    try {

      const handler = (type ? type + '_' : '') + (isRequest ? 'request' : 'response');
      if (plugin['on' + handler] && _.isFunction(plugin['on' + handler])) {
        const fx = function(e, newData) {
          //a small fix introduced to fix issues with plugin API being inconsistent with documentation.
          //Pass a second null to ondata_response event callback then you are able to override the response body
          var args = Array.prototype.slice.call(arguments);
          if(args.length == 2) {
            cb(e, args[1]);
          } else {
            cb(e, data);
          }
        };

        var pluginHandler = plugin['on' + handler];
        var argsLength = pluginHandler.length;
        var args = null;
        if(argsLength === 3) {
          args = [options.sourceRequest, options.sourceResponse, fx];
        } else if(argsLength == 4) {
          args = [options.sourceRequest, options.sourceResponse, data, fx];
        } else if(argsLength == 5) {
          args = [options.sourceRequest, options.sourceResponse, options.targetResponse, data, fx];
        }

        pluginHandler.apply(null, args);
      } else {
        debug("plugin " + plugin.id + " does not provide handler function for " + handler);
        cb(null, data); // plugin does not provide onerror_request, carry on
      }
    } catch (handlerException) {
      logger.error(handlerException, plugin.id + " handler threw an exception")
      cb(handlerException)
    }

  }
};
module.exports.getPluginHookForEvent = getPluginHookForEvent;

const _configured = function(config, property) {
  if (config.headers) {
    const value = config.headers[property];
    return value ? value : _.isUndefined(value); // on if unspecified
  } else {
    return true; // on if no config.headers section
  }
};
