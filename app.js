/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */
import express from "express";
const app = express();

import https from "httpolyglot";
import fs from "fs";
import path from "path";
const __dirname = path.resolve();

import { Server } from "socket.io";
import mediasoup from "mediasoup";

// const getMyIP = require("get-my-ip");
import getMyIP from "get-my-ip";

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res, next) => {
  const path = "/sfu/";

  if (req.path.indexOf(path) == 0 && req.path.length > path.length)
    return next();

  res.send(
    `You need to specify a room name in the path e.g. 'https://127.0.0.1/sfu/room'`
  );
});

app.use(
  "/sfu/:room",
  express.static(path.join(__dirname, "public", "room.html"))
);

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync("./server/ssl/key.pem", "utf-8"),
  cert: fs.readFileSync("./server/ssl/cert.pem", "utf-8"),
};

const httpsServer = https.createServer(options, app);
httpsServer.listen(3000, getMyIP(), () => {
  console.log(`'https://${getMyIP()}:3000/sfu/room`);
  console.log("listening on port: " + 3000);
});

const io = new Server(httpsServer);

// socket.io namespace (could represent a room?)
const connections = io.of("/mediasoup");

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer
 **/
let worker;
let rooms = {}; // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}; // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []; // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []; // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []; // [ { socketId1, roomName1, consumer, }, ... ]

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 3000,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    // This implies something serious happened, so kill the application
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

// We create a Worker as soon as our application starts
worker = createWorker();

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

connections.on("connection", async (socket) => {
  connections.on("unload", (data) => {
    console.log("dataUnload  :", data);
  });
  console.log("socketId : ", socket.id);
  let socketId = socket.id;
  socket.emit("connection-success", {
    socketId: socket.id,
  });

  socket.on("sendMessage", (data) => {
    console.log("data message : ", data.text);
    socket.to(data.text.roomName).emit("sendMessage", {
      message: data.text.message,
      name: data.text.displayName,
      uid: data.text.uid,
    });
  });

  const removeItems = (items, socketId, type) => {
    items.forEach((item) => {
      if (item.uid === socketId) {
        item[type].close();
      }
    });
    items = items.filter((item) => item.uid !== socketId);

    return items;
  };

  const getUsersInRoom = (rooms, peers, roomName) => {
    // Initialiser un tableau pour stocker les détails des utilisateurs dans la salle spécifiée

    console.log("je suis la getUsersInRoom ");

    let peersRoom = rooms[roomName].peers;

    console.log("peers");
    console.log(peersRoom);

    const usersInRoom = [];

    // Parcourir l'objet peers pour trouver les utilisateurs qui sont dans la salle donnée

    for (let i = 0; i < peersRoom.length; i++) {
      const user = peers[peersRoom[i]];
      console.log("idUserInRoom :");
      console.log(peersRoom[i]);

      console.log("user :");
      console.log(user);
      if (user.roomName === roomName) {
        // Exclure le demandeur de la liste
        // Ajouter les détails de l'utilisateur au tableau
        usersInRoom.push({
          uid: user.socket.uid,
          name: user.peerDetails.name,
          isAdmin: user.peerDetails.isAdmin,
        });
      }
    }

    // Vérifier si la salle est vide après exclusion du demandeur
    // if (usersInRoom.length === 0) {
    //   return `No other users in room ${roomName}`;
    // }

    // Retourner le tableau des utilisateurs dans la salle
    return usersInRoom;
  };

  socket.on("disconnect", () => {
    const uidDisconnet = socket.uid;

    console.log("uidDisconnet");
    console.log(uidDisconnet);

    // do some cleanup
    console.log("peer disconnected");
    consumers = removeItems(consumers, uidDisconnet, "consumer");
    producers = removeItems(producers, uidDisconnet, "producer");
    transports = removeItems(transports, uidDisconnet, "transport");

    const { roomName } = peers[uidDisconnet];
    console.log("uidDiscconnect :");
    console.log(uidDisconnet);

    console.log("rooName");
    console.log(roomName);
    delete peers[uidDisconnet];

    connections.to(roomName).emit("leaveRoom", { uidDisconnet });

    // remove socket from room
    rooms[roomName] = {
      router: rooms[roomName].router,
      peers: rooms[roomName].peers.filter((uid) => uid !== uidDisconnet),
    };

    console.log("rooms[roomName] disconnect ");
    console.log(rooms[roomName]);

    if (rooms[roomName].peers.length == 0) {
      delete rooms[roomName];
    }

    console.log("rooms[roomName] disconnect ");
    console.log(rooms[roomName]);
  });

  socket.on("joinRoom", async ({ roomName, name, uid }, callback) => {
    // create Router if it does not exist
    // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)

    let isThere = false;

    let lenghtPeers;

    // let roomss = [...rooms];

    console.log("1rooms.roomName;");
    console.log(rooms[roomName]);

    if (rooms[roomName]) {
      console.log("2rooms.roomName;");
      console.log(rooms[roomName]);
      lenghtPeers = rooms[roomName].peers.length;

      console.log("lenghtPeer :");
      console.log(lenghtPeers);

      console.log("rooms[roomName].peers :");
      console.log(rooms[roomName].peers);
    }

    if (lenghtPeers >= 1) {
      console.log("lengthPeers");
      console.log(lenghtPeers);
      const peers = rooms[roomName].peers;
      for (let i = 0; i < peers.length; i++) {
        console.log("peer[]");
        console.log(peers[i]);

        console.log("uid");
        console.log(uid);
        if (peers[i] == uid) {
          console.log("je suis a true ");
          isThere = true;
          break;
        }
      }
    }

    if (isThere) {
      socket.uid = uid;
      // get Router RTP Capabilities
      const router1 = await getRouter(roomName);
      const rtpCapabilities = router1.rtpCapabilities;

      // call callback from the client and send back the rtpCapabilities
      callback({ rtpCapabilities, listUserRoom });
      isThere = false;
    } else {
      const router1 = await createRoom(roomName, uid);

      // rejoin room
      socket.join(roomName);

      // send message to user room
      socket.to(roomName).emit("user joined", {
        uid,
        name,
        isAdmin: false,
      });

      socket.uid = uid;

      peers[uid] = {
        socket,
        roomName, // Name for the Router this Peer joined
        transports: [],
        producers: [],
        consumers: [],
        peerDetails: {
          name,
          isAdmin: false, // Is this Peer the Admin?
        },
      };

      // console.log("peers[socket.id] : ", peers[socket.id]);
      // console.log("peers.length : ", peers);

      const listUserRoom = getUsersInRoom(rooms, peers, roomName);

      // get Router RTP Capabilities
      const rtpCapabilities = router1.rtpCapabilities;

      // call callback from the client and send back the rtpCapabilities
      callback({ rtpCapabilities, listUserRoom });

      isThere = false;
    }

    isThere = false;
  });

  const createRoom = async (roomName, uid) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1;
    let peers = [];
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      peers = rooms[roomName].peers || [];

      console.log("peers if");
      console.log(peers);
    } else {
      router1 = await worker.createRouter({ mediaCodecs });
    }

    console.log(`Router ID: ${router1.id}`, peers.length);

    rooms[roomName] = {
      router: router1,
      peers: [...peers, uid],
    };

    console.log("rooms[roomName]  createRoom");

    console.log(rooms[roomName]);

    return router1;
  };

  const getRouter = async (roomName) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1;
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;

      console.log("peers if");
      console.log(peers);
    } else {
      router1 = await worker.createRouter({ mediaCodecs });
    }

    console.log(`Router ID: ${router1.id}`);

    return router1;
  };

  // socket.on('createRoom', async (callback) => {
  //   if (router === undefined) {
  //     // worker.createRouter(options)
  //     // options = { mediaCodecs, appData }
  //     // mediaCodecs -> defined above
  //     // appData -> custom application data - we are not supplying any
  //     // none of the two are required
  //     router = await worker.createRouter({ mediaCodecs, })
  //     console.log(`Router ID: ${router.id}`)
  //   }

  //   getRtpCapabilities(callback)
  // })

  // const getRtpCapabilities = (callback) => {
  //   const rtpCapabilities = router.rtpCapabilities

  //   callback({ rtpCapabilities })
  // }

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on("createWebRtcTransport", async ({ consumer, uid }, callback) => {
    // get Room Name from Peer's properties
    const roomName = peers[uid].roomName;

    // get Router (Room) object this peer is in based on RoomName
    const router = rooms[roomName].router;

    createWebRtcTransport(router).then(
      (transport) => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });

        // add transport to Peer's properties
        addTransport(transport, roomName, consumer, uid);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  const addTransport = (transport, roomName, consumer, uid) => {
    transports = [...transports, { uid, transport, roomName, consumer }];

    peers[uid] = {
      ...peers[uid],
      transports: [...peers[uid].transports, transport.id],
    };
  };

  const addProducer = (producer, roomName, uid) => {
    producers = [...producers, { uid, producer, roomName }];

    peers[uid] = {
      ...peers[uid],
      producers: [...peers[uid].producers, producer.id],
    };
  };

  const addConsumer = (consumer, roomName, uid) => {
    // add the consumer to the consumers list
    consumers = [...consumers, { uid, consumer, roomName }];

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[uid],
      consumers: [...peers[uid].consumers, consumer.id],
    };
  };

  socket.on("getProducers", ({ uid }, callback) => {
    //return all producer transports
    const { roomName } = peers[uid];

    let producerList = [];
    producers.forEach((producerData) => {
      if (producerData.uid !== uid && producerData.roomName === roomName) {
        producerList = [...producerList, producerData.producer.id];
      }
    });

    // return the producer list back to the client
    callback(producerList);
  });

  const informConsumers = (roomName, uid, id) => {
    console.log(`just joined, id ${id} ${roomName}, ${uid}`);
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach((producerData) => {
      if (producerData.uid !== uid && producerData.roomName === roomName) {
        const producerSocket = peers[producerData.uid].socket;
        // use socket to send producer id to producer
        producerSocket.emit("new-producer", { producerId: id });
      }
    });
  };

  const getTransport = (uid) => {
    const [producerTransport] = transports.filter(
      (transport) => transport.uid === uid && !transport.consumer
    );
    return producerTransport.transport;
  };

  // see client's socket.emit('transport-connect', ...)
  socket.on("transport-connect", ({ dtlsParameters, uid }) => {
    console.log("DTLS PARAMS... ", { dtlsParameters });

    getTransport(uid).connect({ dtlsParameters });
  });

  // see client's socket.emit('transport-produce', ...)
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData, uid }, callback) => {
      // call produce based on the prameters from the client
      const producer = await getTransport(uid).produce({
        kind,
        rtpParameters,
      });

      // add producer to the producers array
      const { roomName } = peers[uid];

      addProducer(producer, roomName, uid);

      informConsumers(roomName, uid, producer.id);

      console.log("Producer ID: ", producer.id, producer.kind);

      producer.on("transportclose", () => {
        console.log("transport for this producer closed ");
        producer.close();
      });

      // Send back to the client the Producer's id
      callback({
        id: producer.id,
        producersExist: producers.length > 1 ? true : false,
      });
    }
  );

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      const consumerTransport = transports.find(
        (transportData) =>
          transportData.consumer &&
          transportData.transport.id == serverConsumerTransportId
      ).transport;
      await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId, uid },
      callback
    ) => {
      try {
        const { roomName } = peers[uid];
        const router = rooms[roomName].router;
        let consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId
        ).transport;

        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit("producer-closed", {
              remoteProducerId,
            });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id
            );
          });

          addConsumer(consumer, roomName, uid);

          // from the consumer extract the following params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
          };

          // send the parameters to the client
          callback({ params });
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    }
  );

  socket.on("consumer-resume", async ({ serverConsumerId }) => {
    console.log("consumer resume");
    const { consumer } = consumers.find(
      (consumerData) => consumerData.consumer.id === serverConsumerId
    );
    await consumer.resume();
  });
});

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: getMyIP(), // replace with relevant IP address
            // announcedIp: getMyIP(),
          },
        ],
        initialAvailableOutgoingBitrate: 1000000,
        minimumAvailableOutgoingBitrate: 600000,
        maxIncomingBitrate: 1500000,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};
