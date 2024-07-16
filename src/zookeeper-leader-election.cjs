const zookeeper = require("node-zookeeper-client");
const {CreateMode} = zookeeper;
const EE = require("node:events").EventEmitter;
const assert = require("node:assert/strict");

/**
 * @namespace ZookeeperLeaderElection
 */

/** @typedef {{ host: string, zNodeName: string, childrenPrefix: string, sessionTimeout?: number, spinDelay?: number, retries?: number }} ClientOptions
 * @memberOf ZookeeperLeaderElection
 * */

/** @enum {string}
 * readonly
 * @memberOf ZookeeperLeaderElection
 * */
const ClientEvents = {
    CHILD_CREATED: "childCreated",
    CLIENT_CONNECTED: "clientConnected",
    CLIENT_DISCONNECTED: "clientDisconnected",
    ERROR: "error",
    LEADER_CHANGED: "leaderChanged",
    NODE_CHILDREN_CHANGED: "nodeChildrenChanged",
    NODE_CREATED: "nodeCreated",
    NODE_REMOVED: "nodeRemoved"
}

/**
 * Extract the numeric identifier from a given child node path
 *
 * @param {string} childNodePath
 * @returns {number}
 * @memberOf ZookeeperLeaderElection
 */
const extractId = (childNodePath) => {
    const childPathRegExp = new RegExp(/(?<=(^(\w|-)+))\d+$/);
    const fullPathRegExp = new RegExp(/(?<=(^\/(\w|-)+\/(\w|-)+))\d+$/);
    const matches = childNodePath.match(childPathRegExp) ??
        childNodePath.match(fullPathRegExp);
    return +matches?.at(0);
}

/**
 * Check whether a zNode name provided is valid
 *
 * @param zNodeName
 * @returns {boolean}
 * @memberOf ZookeeperLeaderElection
 */
const isValidZNodeName = zNodeName => !!zNodeName.match(/^\/(\w|-)+$/)?.at(0);

/**
 * Check whether a children prefix provided is valid
 *
 * @param childrenPrefix
 * @returns {boolean}
 * @memberOf ZookeeperLeaderElection
 */
const isValidChildrenPrefix = childrenPrefix => !!childrenPrefix.match(/^(\w|-)+$/)?.at(0);

/**
 * A Zookeeper client handling leader election
 *
 * @constructor
 * @param {ClientOptions} opts
 * @memberOf ZookeeperLeaderElection
 */
class ZookeeperLeaderElection extends EE {

    constructor(opts) {
        super();
        assert.ok(isValidZNodeName(opts.zNodeName), Error("property zNodeName must start with \'/\' and allows a-z, A-Z, 0-9, -, _"))
        assert.ok(isValidChildrenPrefix(opts.childrenPrefix), Error("property childrenPrefix allows a-z, A-Z, 0-9, -, _"))
        this.host = opts.host;
        this.zNodeName = opts.zNodeName;
        this.path = `${opts.zNodeName}/${opts.childrenPrefix}`;
        this.sessionTimeout = opts.sessionTimeout ?? 30000;
        this.spinDelay = opts.spinDelay ?? 1000;
        this.retries = opts.retries ?? 0;
        this.id = null;
        this.zNodeStat = null;
        this.isLeader = false;
        this.disconnecting = false;
        this.disconnected = true;
    }

    /**
     * Initializes and connects the Zookeeper client
     *
     * @public
     * @fires ClientEvents.CLIENT_CONNECTED
     * @fires ClientEvents.CLIENT_DISCONNECTED
     * @fires ClientEvents.ERROR
     */
    init = () => {
        const {sessionTimeout, spinDelay, retries} = this;
        this.client = zookeeper
            .createClient(this.host, {sessionTimeout, spinDelay, retries})
            .once("connected", (error, _) => {
                if (error) {
                    /**
                     * @event ClientEvents.ERROR
                     * @type {Object}
                     */
                    this.emit(ClientEvents.ERROR, error);
                    return;
                }
                /**
                 * @event ClientEvents.CLIENT_CONNECTED
                 * @typedef {{host: string}}
                 */
                this.emit(ClientEvents.CLIENT_CONNECTED, {host: this.host})
                this.#zNodeExists();
            })
            .once("disconnected", (error, _) => {
                if (error) {
                    /**
                     * @event ClientEvents.ERROR
                     * @type {Object}
                     */
                    this.emit(ClientEvents.ERROR, error);
                    return;
                }
                this.disconnected = true;
                /**
                 * @event ClientEvents.CLIENT_DISCONNECTED
                 * @typedef {{host: string, path: string, id: number}}
                 */
                this.emit(ClientEvents.CLIENT_DISCONNECTED, {host: this.host, path: this.zNodeName, id: this.id})
            });
        this.client.connect();
    }

    /**
     * Close the Zookeeper client
     *
     * @public
     */
    close = () => {
        this.disconnecting = true;
        this.client?.close();
    }

    /**
     * Defines if the current client is the leader instance
     *
     * @private
     * @param {string[]} children the children ids list
     * @fires ClientEvents.LEADER_CHANGED
     */
    #electLeader = children => {
        const prev = this.isLeader;
        this.isLeader = this.id !== null &&
            children.map(extractId).find(item => item < this.id) === undefined;
        if (prev !== this.isLeader) {
            /**
             * @event ClientEvents.LEADER_CHANGED
             * @typedef {{path: string, isLeader:boolean, id: number}}
             */
            this.emit(ClientEvents.LEADER_CHANGED, {path: this.zNodeName, isLeader: this.isLeader, id: this.id});
        }
    }

    /**
     * Ask for the zNode children list
     *
     * @private
     * @fires ClientEvents.NODE_CHILDREN_CHANGED if the zNode notifies a children list change
     */
    #listChildren = () => {
        this.client.getChildren(
            this.zNodeName,
            _ => {
                if (!(this.disconnecting || this.disconnected)) {
                    this.#listChildren();
                    /**
                     * @event ClientEvents.NODE_CHILDREN_CHANGED
                     * @typedef {{path: string, isLeader:boolean, id: number}}
                     */
                    this.emit(ClientEvents.NODE_CHILDREN_CHANGED, {
                        path: this.zNodeName,
                        isLeader: this.isLeader,
                        id: this.id
                    });
                }
            },
            (error, children) => {
                if (error) {
                    /**
                     * @event ClientEvents.ERROR
                     * @type {Object}
                     */
                    this.emit(ClientEvents.ERROR, error);
                    return;
                }
                this.#electLeader(children);
            }
        );
    }

    /**
     * Creates the zNode
     *
     * @public
     * @fires ClientEvents.ERROR
     */
    createZNode = () => this.client.create(
        this.zNodeName,
        CreateMode.PERSISTENT,
        error => {
            if (error) {
                /**
                 * @event ClientEvents.ERROR
                 * @type {Object}
                 */
                this.emit(ClientEvents.ERROR, error);
            }
        }
    )

    /**
     * Verifies the zNode existence.
     * Whether the zNode exist creates a new child, otherwise creates the zNode and creates a new child
     *
     * @private
     * @fires ClientEvents.NODE_CREATED
     * @fires ClientEvents.ERROR
     */
    #zNodeExists = () => {
        this.client.exists(
            this.zNodeName,
            _ => {
                this.#zNodeExists();
                /**
                 * @event ClientEvents.NODE_CREATED
                 * @typedef {{path: string}}
                 */
                this.emit(ClientEvents.NODE_CREATED, {path: this.zNodeName});
            },
            (error, stat) => {
                if (error) {
                    /**
                     * @event ClientEvents.ERROR
                     * @type {Object}
                     */
                    this.emit(ClientEvents.ERROR, error);
                    return;
                }
                if (!!stat) {
                    this.zNodeStat = stat;
                    this.#createChild();
                } else {
                    this.createZNode();
                }
            }
        )
    }

    /**
     * Creates a child node
     *
     * @private
     * @fires ClientEvents.CHILD_CREATED
     * @fires ClientEvents.ERROR
     */
    #createChild = () => this.client.create(
        this.path,
        CreateMode.EPHEMERAL_SEQUENTIAL,
        (error, path) => {
            if (error) {
                /**
                 * @event ClientEvents.ERROR
                 * @type {Object}
                 */
                this.emit(ClientEvents.ERROR, error);
                return;
            }
            if (path) {
                this.id = extractId(path);
                this.#listChildren();
                /**
                 * @event ClientEvents.CHILD_CREATED
                 * @typedef {{path: string, isLeader: boolean, id: number}}
                 */
                this.emit(ClientEvents.CHILD_CREATED, {path: this.zNodeName, isLeader: this.isLeader, id: this.id})
            }
        }
    )

    /**
     * Removes the zNode
     *
     * @public
     * @fires ClientEvents.NODE_REMOVED
     * @fires ClientEvents.ERROR
     */
    deleteZNode = () => {
        const invokeClientRemove = that => that.client.remove(
            this.zNodeName,
            error => {
                if (error) {
                    /**
                     * @event ClientEvents.ERROR
                     * @type {Object}
                     */
                    that.emit(ClientEvents.ERROR, error);
                    return;
                }
                /**
                 * @event ClientEvents.NODE_REMOVED
                 * @typedef {{path: string, isLeader: boolean, id: number}}
                 */
                that.emit(ClientEvents.NODE_REMOVED, {path: that.zNodeName, isLeader: that.isLeader, id: this.id});
            });
        const connectionCallback = (error, _) => {
            if (error) {
                /**
                 * @event ClientEvents.ERROR
                 * @type {Object}
                 */
                this.emit(ClientEvents.ERROR, error);
                return;
            }
            this.disconnecting = false;
            this.disconnected = false;
            invokeClientRemove(this);
        };
        if (!this.client || this.disconnected) {
            this.client = zookeeper
                .createClient(this.host)
                .once("connected", connectionCallback.bind(this))
            this.client.connect();
        } else {
            invokeClientRemove(this)
        }
    }
}

module.exports = {
    ClientEvents,
    extractId,
    isValidZNodeName,
    isValidChildrenPrefix,
    ZookeeperLeaderElection
};

