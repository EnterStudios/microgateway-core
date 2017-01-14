'use strict'

const _ = require('lodash')
const assert = require('assert')
const gatewayService = require('../index')
const request = require('request')
const restify = require('restify')
const should = require('should')
const fs = require('fs');

const gatewayPort = 8000
const port = 3300
const baseConfig = {
  "scopes": {
    "1": {
      "proxies": {
        "edgemicro_whatsup": {
          "revision": "15",
          "proxy_name": "default",
          "base_path": "/v1",
          "target_name": "default",
          "url": "http://localhost:3300/",
          "PropBUNDLE_LEVEL": "bar1",
          "PropSCOPE_LEVEL": "foo1",
          "vhost": "myvhost",
          "plugins": [
            "spikearrest"
          ],
          "scope": "1"
        }
      }
    }
  },
  "proxies": [
    {
      "revision": "15",
      "proxy_name": "default",
      "base_path": "/v1",
      "target_name": "default",
      "url": "http://localhost:3300/",
      "PropBUNDLE_LEVEL": "bar1",
      "PropSCOPE_LEVEL": "foo1",
      "vhost": "myvhost",
      "plugins": [
        "spikearrest"
      ],
      "scope": "1"
    }
  ],
  "system": {
    "logging": {
      "level": "error",
      "dir": "/var/tmp",
      "stats_log_interval": 60,
      "rotate_interval": 24
    },
    "port": 8000,
    "max_connections": 1000,
    "max_connections_hard": 5000,
    "restart_sleep": 500,
    "restart_max": 50,
    "max_times": 300,
    "vhosts": {
      "myvhost": {
        "vhost": "localhost:8000",
        "cert": "./tests/server.crt",
        "key": "./tests/server.key"
      }
    },
    "ssl": {
      key: './tests/server.key',
      cert: './tests/server.crt'
    }
  }
};

var gateway
var server

const startGateway = (config, handler, done) => {
  server = restify.createServer({});

  server.use(restify.gzipResponse());
  server.use(restify.bodyParser());

  server.get('/', handler);

  server.listen(port, function() {
    console.log('%s listening at %s', server.name, server.url)

    gateway = gatewayService(config)

    done()
  })
}

describe('test ssl configuration handling', () => {
  afterEach((done) => {
    if (gateway) {
      gateway.stop(() => {})
    }

    if (server) {
      server.close()
    }

    done()
  })

  describe('config', () => {
    describe('ssl', () => {
      it('can request against an ssl endpoint', (done) => {
        startGateway(baseConfig, (req, res, next) => {
          assert.equal('localhost:' + port, req.headers.host)
          res.end('OK')
        }, () => {
          gateway.start((err) => {
            assert(!err, err)

            request({
              method: 'GET',
              key: fs.readFileSync('./tests/server.key'),
              cert: fs.readFileSync('./tests/server.crt'),    
              rejectUnauthorized: false,
              url: 'https://localhost:' + gatewayPort + '/v1'
            }, (err, r, body) => {
              console.log(err);
              assert.ok(!err)
              assert.equal('OK', body)
              done()
            })
          })
        })
      })
    })
  })
})
