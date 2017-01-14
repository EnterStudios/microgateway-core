'use strict'

const _ = require('lodash')
const assert = require('assert')
const gatewayService = require('../index')
const request = require('request')
const https = require('https')
const should = require('should')
const fs = require('fs');

const gatewayPort = 8000
const port = 3300
const baseConfig = {
  "scopes": {
    "1": {
      "proxies": {
        "edgemicro_whatsup": {
          "secure": true,
          "revision": "15",
          "proxy_name": "default",
          "base_path": "/v1",
          "target_name": "default",
          "url": "https://localhost:3300/",
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
      "secure": true,
      "revision": "15",
      "proxy_name": "default",
      "base_path": "/v1",
      "target_name": "default",
      "url": "https://localhost:3300/",
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
    }
  }
};

baseConfig.targets = [
  {
    host: 'localhost',
    ssl: {
      client: {
        cert: './tests/server.crt',
        key: './tests/server.key',
        rejectUnauthorized: false
      }
    }
  }  
];

var gateway
var server

const startGateway = (config, handler, done) => {
  const opts = {
    key: fs.readFileSync('./tests/server.key'),
    cert: fs.readFileSync('./tests/server.crt') 
  };
  server = https.createServer(opts, handler);

  server.listen(port, function() {
    console.log('%s listening at %s', server.name, server.url)

    gateway = gatewayService(config)

    done()
  })
}

describe('test configuration handling', () => {
  afterEach((done) => {
    if (gateway) {
      gateway.stop(() => {})
    }

    if (server) {
      server.close()
    }

    done()
  })

  describe('target', () => {
    describe('ssl', () => {
      it('ssl can be enabled between em and target', (done) => {
        console.log(baseConfig);
        startGateway(baseConfig, (req, res) => {
          assert.equal('localhost:' + port, req.headers.host)
          res.end('OK')
        }, () => {
          gateway.start((err) => {
            assert.ok(!err)

            request({
              method: 'GET',
              url: 'http://localhost:' + gatewayPort + '/v1'
            }, (err, r, body) => {
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
