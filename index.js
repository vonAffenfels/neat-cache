"use strict";

var Application = require("neat-base").Application;
var Module = require("neat-base").Module;
var {createClient} = require("redis");
var Promise = require("bluebird");
var crypto = require('crypto');
var request = require('request');
const apeStatus = require('ape-status');

module.exports = class Cache extends Module {

    static defaultConfig() {
        return {
            "enabled": false,
            "prefix": "prod_",
            "host": "localhost",
            "password": null,
            "port": 6379,
            "db": 0,
            "caches": {
                "default": {
                    "expires": 3600,
                },
            },
        };
    }

    init() {
        return new Promise(async (resolve, reject) => {
            this.log.debug("Initializing...");
            this.connected = false;
            let self = this;

            if (this.config.enabled) {
                let options = {
                    socket: {
                        host: this.config.host,
                        // retry_strategy: function (options) {
                        //     self.log.debug("Reconnecting to session redis in 1 second");
                        //     return 1000;
                        // },
                        port: this.config.port,
                    },
                    password: this.config.password,
                    database: this.config.db || 0,
                };

                if (!this.config.password) {
                    delete options.password;
                }

                this.redis = createClient(options);
                //Add error handlers before the connect. only then does the reconnect work properly
                this.redis.on("error", (err) => {
                    this.log.warn(err);
                });

                this.redis.on("connect", () => {
                    this.connected = true;
                    this.log.info("Redis Connected");
                });
                this.redis.on('reconnecting', () => this.log.info('client is reconnecting'));
                this.redis.on('ready', () => this.log.info('client is ready'));

                await this.redis.connect();
                apeStatus.redis(this.redis, "cache");

                this.redis.select(this.config.db);
            }

            resolve(this);
        });
    }

    getKeyFromObject(obj) {
        var hash = crypto.createHash("md5");
        hash.update(JSON.stringify(obj));
        hash.update(this.config.prefix);
        return hash.digest("hex");
    }

    getKeyFromString(str) {
        var hash = crypto.createHash("md5");
        hash.update(str);
        hash.update(this.config.prefix);
        return hash.digest("hex");
    }

    get(key) {
        return new Promise(async (resolve, reject) => {
            if (!this.config.enabled || !this.connected) {
                return resolve();
            }

            try {
                const val = await this.redis.get(key);
                if(val){
                    return resolve(JSON.parse(val));
                }
            } catch (e) {
                this.log.error(e);
                return resolve();
            }

            return this.redis.get(key, (err, data) => {
                if (err) {
                    return reject(err);
                }

                if (!data) {
                    return resolve();
                }

                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    this.log.error(e);
                    resolve();
                }
            });
        });
    }

    set(key, val, options) {
        return new Promise((resolve, reject) => {
            var jsonVal = null;

            if (!this.config.enabled || !this.connected) {
                return resolve(val);
            }


            if (typeof val !== "string") {
                try {
                    var jsonVal = JSON.stringify(val);
                } catch (e) {
                    return reject(e);
                }
            }

            if (parseInt(options) == options) {
                options = {
                    expires: options,
                };
            }

            if (this.config.debugCacheTTL) {
                options.expires = this.config.debugCacheTTL;
            }

            this.redis.set(key, jsonVal);

            if (options && options.expire) {
                this.redis.expire(key, options.expires, (err) => {
                    if (err) {
                        this.log.error("Error while setting expire time of " + key + " to " + options.expires + ": " + err.toString());
                    }
                });
            }

            return resolve(val);
        });
    }

    clearVarnishCache(path) {
        return new Promise((resolve, reject) => {
            var url = Application.appConfigs.misc.url + path;

            this.log.debug("Purging Varnish cache of " + url);
            request({
                url: url,
                method: "PURGE",
            });
        });
    }

    clearPageCache(url) {
        this.log.debug("Clearing cache of " + url);
        return new Promise((resolve, reject) => {
            request({
                url: url + "?clearCache=true",
            });
        });
    }

    start() {
        return new Promise((resolve, reject) => {
            this.log.debug("Connecting...");
            return resolve(this);
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            this.log.debug("Stopping...");
            return resolve(this);
        });
    }

};
