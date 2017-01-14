module.exports = {
  "oauth": {},
  "analytics": {
    "source": "microgateway",
    "proxy": "dummy",
    "proxy_revision": 1,
    "compress": false,
    "flushInterval": 250,
    "uri": "https://edgemicroservices-us-east-1.apigee.net/edgemicro/axpublisher/organization/ws-poc3/environment/test"
  },
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
    }
  },
  "headers": {
    "x-forwarded-for": true,
    "x-forwarded-host": true,
    "x-request-id": true,
    "x-response-time": true,
    "via": true
  },
  "spikearrest": {
    "timeUnit": "minute",
    "allow": 10,
    "buffersize": 0
  }
}
