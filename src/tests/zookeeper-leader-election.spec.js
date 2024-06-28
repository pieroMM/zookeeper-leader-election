import {describe, it, beforeEach, afterEach, after, mock} from 'node:test';
import {TIMEOUT_EXPIRED, waitForPredicate} from "wait-for-predicate";
import * as assert from "assert";
import {GenericContainer} from "testcontainers";
import {ClientEvents, ZookeeperLeaderElection} from "../zookeeper-leader-election.mjs";
import zookeeper from "node-zookeeper-client";

describe('Zookeeper Client', async () => {
    let container, host;

    beforeEach(async () => {
        container = await new GenericContainer('zookeeper')
            .withExposedPorts(2181)
            .start();

        host = `${container.getHost()}:${container.getMappedPort(2181)}`;
    });

    afterEach(async () => {
        await container.stop();
    });

    after(() => { process.exit(0) });

    await it('Create single client node and elect the leader', async () => {

        const opts = {
            host,
            zNodeName: '/connect-election',
            childrenPrefix: 'guid-n_',
            sessionTimeout: 10000,
            spinDelay: 1000,
            retries: 0
        };

        const clientConnectedCallback = mock.fn(() => {
        });
        const childCreatedCallback = mock.fn(() => {
        });
        const leaderChangedCallback = mock.fn(() => {
        });
        const nodeChildrenChangedCallback = mock.fn(() => {
        });
        const nodeCreatedCallback = mock.fn(() => {
        });
        const nodeRemovedCallback = mock.fn(() => {
        });

        const client = new ZookeeperLeaderElection(opts)
            .on(ClientEvents.CLIENT_CONNECTED, clientConnectedCallback)
            .on(ClientEvents.CHILD_CREATED, childCreatedCallback)
            .on(ClientEvents.LEADER_CHANGED, leaderChangedCallback)
            .on(ClientEvents.NODE_CHILDREN_CHANGED, nodeChildrenChangedCallback)
            .on(ClientEvents.NODE_CREATED, nodeCreatedCallback)
            .on(ClientEvents.NODE_REMOVED, nodeRemovedCallback);

        client.init();

        try {

            await waitForPredicate(
                () => !!childCreatedCallback.mock.calls?.length && !!leaderChangedCallback.mock.calls?.length,
                {timeout: 10000});

            assert.strictEqual(clientConnectedCallback.mock.calls?.length, 1);
            assert.strictEqual(childCreatedCallback.mock.calls?.length, 1);
            assert.strictEqual(leaderChangedCallback.mock.calls?.length, 1);
            assert.strictEqual(nodeCreatedCallback.mock.calls?.length, 1);
            assert.strictEqual(nodeChildrenChangedCallback.mock.calls?.length, 0);
            assert.strictEqual(nodeRemovedCallback.mock.calls?.length, 0);

        } catch (error) {
            if (error.message === TIMEOUT_EXPIRED) {
                assert.fail('Timeout expired');
            } else {
                throw error;
            }
        } finally {
            client.close();
        }
    });

    await it('Create clients becoming leaders in sequence', async () => {
        const leadersSequence = [];

        const opts = {
            host,
            zNodeName: '/connect-election',
            childrenPrefix: 'guid-n_',
            sessionTimeout: 10000,
            spinDelay: 1000,
            retries: 0
        };

        const willBeLeaderFirst = new ZookeeperLeaderElection(opts);
        const willBeLeaderLater = new ZookeeperLeaderElection(opts);

        willBeLeaderFirst
            .on(ClientEvents.LEADER_CHANGED, _ => {
                leadersSequence.push(willBeLeaderFirst.id);
                willBeLeaderFirst.close();
            })
            .on(ClientEvents.CHILD_CREATED, _ => {
                willBeLeaderLater.init();
            })
            .on(ClientEvents.ERROR, err => {
                assert.fail(err.message);
            })

        willBeLeaderLater.on(ClientEvents.LEADER_CHANGED, _ => {
            leadersSequence.push(willBeLeaderLater.id);
            willBeLeaderLater.close();
        })
            .on(ClientEvents.ERROR, err => {
                assert.fail(err.message);
            });

        willBeLeaderFirst.init();
        try {
            await waitForPredicate(
                () => leadersSequence.length >= 2,
                {timeout: 30000});

            assert.strictEqual(leadersSequence[0], willBeLeaderFirst.id);
            assert.strictEqual(leadersSequence[1], willBeLeaderLater.id);
        } catch (error) {
            if (error.message === TIMEOUT_EXPIRED) {
                assert.fail('Timeout expired');
            } else {
                throw error;
            }
        }
    });

    await it('Omit the zNode existence, check and capture the error', async () => {

        let error = null;

        const opts = {
            host,
            zNodeName: '/connect-election',
            childrenPrefix: 'guid-n_',
            sessionTimeout: 10000,
            spinDelay: 1000,
            retries: 0
        };

        const firstClient = new ZookeeperLeaderElection(opts);
        const secondClient = new ZookeeperLeaderElection(opts)
            .on(ClientEvents.ERROR, _error => {
            error = _error });

        firstClient.on(ClientEvents.NODE_CREATED, () => {
            secondClient.init();
        });

        /**
         * Forcing the init method to create the zNode without checking for its existence,
         * Client should give a NODE_EXISTS exception
         */
        const noCheckInit = that => {
            const {sessionTimeout, spinDelay, retries} = that;
            that.client = zookeeper.createClient(that.host, {sessionTimeout, spinDelay, retries});
            that.client.once('connected', error => {
                if (error) {
                    that.emit(ClientEvents.ERROR, error);
                    return;
                }
                that.createZNode();
            });
            that.client.connect();
        }
        mock.method(
            secondClient,
            'init',
            noCheckInit.bind(null, secondClient),
            { times: 1 }
        );

        firstClient.init();

        try {
            await waitForPredicate(() => error !== null, {timeout: 30000});
            assert.strictEqual(error.name, 'NODE_EXISTS');
        } catch (error) {
            if (error.message === TIMEOUT_EXPIRED) {
                assert.fail('Timeout expired');
            } else {
                throw error;
            }
        } finally {
            firstClient.close();
            secondClient.close();
        }
    });

    await it('zNode remove', async () => {

        let deleted = false;

        const opts = {
            host,
            zNodeName: '/connect-election',
            childrenPrefix: 'guid-n_',
            sessionTimeout: 10000,
            spinDelay: 1000,
            retries: 0
        };

        const client = new ZookeeperLeaderElection(opts)
            .on(ClientEvents.CHILD_CREATED, _ => {
                client.close()
            })
            .on(ClientEvents.CLIENT_DISCONNECTED, _ => {
                client.deleteZNode();
            })
            .on(ClientEvents.NODE_REMOVED, _ => {
                deleted = true;
            });

        client.init();

        try {
            await waitForPredicate(() => !!deleted, {timeout: 30000});
            assert.ok(deleted);
        } catch (error) {
            if (error.message === TIMEOUT_EXPIRED) {
                assert.fail('Timeout expired');
            } else {
                throw error;
            }
        } finally {
            client.close();
        }
    });

    await it('try to remove a non-empty zNode', async () => {

        let errorName = null;

        const opts = {
            host,
            zNodeName: '/connect-election',
            childrenPrefix: 'guid-n_',
            sessionTimeout: 10000,
            spinDelay: 1000,
            retries: 0
        };

        const client = new ZookeeperLeaderElection(opts)
            .on(ClientEvents.CHILD_CREATED, _ => {
                client.deleteZNode();
            })
            .on(ClientEvents.ERROR, error => {
                errorName = error.name
            })

        client.init();

        try {
            await waitForPredicate(() => !!errorName, {timeout: 30000});
            assert.strictEqual(errorName, 'NOT_EMPTY');
        } catch (error) {
            if (error.message === TIMEOUT_EXPIRED) {
                assert.fail('Timeout expired');
            } else {
                throw error;
            }
        } finally {
            client.close();
        }
    });
});
