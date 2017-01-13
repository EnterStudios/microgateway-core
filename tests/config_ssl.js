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
const baseConfig = require('./baseConfig');
baseConfig.system.ssl = {
  key: './tests/server.key',
  cert: './tests/server.crt' 
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
