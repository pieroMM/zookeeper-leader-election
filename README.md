# Zookeeper Leader Election

A simple event based leader election utility.

## Installation

```bash
npm i zookeeper-leader-election
```

## Usage

```javascript

import {ClientEvents, ZookeeperLeaderElection} from 'zookeeper-leader-election';

const opts = {
    host: 'localhost:2181',
    zNodeName: '/connect-election',
    childrenPrefix: 'guid-n_',
};

const client = new ZookeeperLeaderElection(opts)
    .on(ClientEvents.CHILD_CREATED, ({path, isLeader, id}) => { console.log(`[Child Created], path: ${path}, isLeader: ${isLeader}, id: ${id}`)})
    .on(ClientEvents.CLIENT_CONNECTED, ({host}) => { console.log(`[Client Connected], host: ${host}`)})
    .on(ClientEvents.CLIENT_DISCONNECTED, ({host, path, id}) => { console.log(`[Client Disconnected], host: ${host}, path: ${path}, id: ${id}`)})
    .on(ClientEvents.ERROR, error => { console.error(`[Error], ${JSON.stringify(error)}`)})
    .on(ClientEvents.LEADER_CHANGED, ({path, isLeader, id}) => { console.log(`[Leader Changed], path: ${path}, isLeader: ${isLeader}, id: ${id}`)})
    .on(ClientEvents.NODE_CHILDREN_CHANGED, ({path, isLeader, id}) => { console.log(`[Node Children Changed], path: ${path}, isLeader: ${isLeader}, id: ${id}`)})
    .on(ClientEvents.NODE_CREATED, ({path}) => { console.log(`[Client Created], path: ${path}`)})
    .on(ClientEvents.NODE_REMOVED, ({path, isLeader, id}) => { console.log(`[Node Removed], path: ${path}, isLeader: ${isLeader}, id: ${id}`)});

client.init();
```

## Events
* **CHILD_CREATED:** is triggered whether the current client instance has been created
* **CLIENT_CONNECTED:** is triggered when the current client instance connects to Zookeeper
* **CLIENT_DISCONNECTED:** is triggered when the current client instance disconnects from Zookeeper,
* **ERROR:** is triggered when a generic error has been issued
* **LEADER_CHANGED:** is triggered whether the current client leader status changes 
* **NODE_CHILDREN_CHANGED:** is triggered whether the sequence of clients associated to the current zNode changes 
* **NODE_CREATED:** is triggered when the zNode which the current client would attach to has been created
* **NODE_REMOVED:** is triggered when the zNode attached to the current client has been removed
## License
[ISC](http://opensource.org/licenses/ISC)
