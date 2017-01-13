'use strict'

const _ = require('lodash')
const assert = require('assert')
const gatewayService = require('../index')
const request = require('request')
const restify = require('restify')
const should = require('should')

const gatewayPort = 8000
const port = 3300
const baseConfig = require('./baseConfig.js');
console.log(baseConfig);
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

  describe('headers', () => {
    describe('host', () => {
      it.only('false (default value)', (done) => {
        startGateway(baseConfig, (req, res, next) => {
          assert.equal('localhost:' + port, req.headers.host)
          res.end('OK')
        }, () => {
          console.log('startGateway cb');
          gateway.start((err) => {
            console.log('here2');
            assert.ok(!err)
            console.log('here3');
            request({
              method: 'GET',
              url: 'http://localhost:' + gatewayPort + '/v1'
            }, (err, r, body) => {

              console.log('here4');
              console.log(err);
              assert.ok(!err)
              assert.equal('OK', body)
              console.log('here5');
              done()
            })
          })
        })
      })

      it('true', (done) => {
        var config = _.cloneDeep(baseConfig)

        config.headers = {
          host: false
        }

        startGateway(config, (req, res, next) => {
          console.log(req.headers);
          assert.equal('localhost:' + gatewayPort, req.headers.host)
          res.end('OK')
        }, () => {
          gateway.start((err) => {
            assert(!err, err)

            request({
              method: 'GET',
              url: 'http://localhost:' + gatewayPort + '/v1'
            }, (err, r, body) => {
              assert(!err, err)
              assert.equal('OK', body)
              done()
            })
          })
        })
      })
    })
  })
})
