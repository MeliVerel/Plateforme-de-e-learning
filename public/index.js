//index.js

class RemoteAudioPlayer {
  constructor(track) {
    // Créer un élément audio HTML
    this.audioElement = document.createElement("audio");

    // Créer un MediaStream et ajouter le track audio
    this.stream = new MediaStream();
    this.stream.addTrack(track);

    // Configurer l'élément audio
    this.audioElement.srcObject = this.stream;
    this.audioElement.play(); // Lancer la lecture

    // Configurer l'audio pour qu'il ne soit pas visible
    this.audioElement.style.position = "absolute";
    this.audioElement.style.left = "-1000px"; // Déplacer l'élément hors de l'écran

    // Ajouter l'élément audio au corps du document
    document.body.appendChild(this.audioElement);
  }

  // Méthode pour démarrer la lecture de l'audio
  play() {
    this.audioElement
      .play()
      .then(() => {
        console.log("La lecture de l'audio distant a commencé.");
      })
      .catch((error) => {
        console.error("Erreur lors de la lecture de l'audio distant:", error);
      });
  }

  // Méthode pour arrêter la lecture de l'audio
  stop() {
    this.audioElement.pause();
    this.audioElement.currentTime = 0; // Réinitialiser le temps de lecture
    console.log("La lecture de l'audio distant a été arrêtée.");
  }

  // Méthode pour libérer les ressources utilisées
  destroy() {
    this.stop(); // Arrêter la lecture
    this.stream.getTracks().forEach((track) => track.stop()); // Arrêter tous les tracks
    document.body.removeChild(this.audioElement); // Retirer l'élément audio du document
    console.log("Le lecteur audio distant a été détruit.");
  }
}

class AudioTrackHandler {
  constructor(track) {
    this.track = track; // La piste MediaStreamTrack pour l'audio
    this.audioContext = new AudioContext(); // Créer un contexte audio
    this.sourceNode = null; // Noeud source pour l'API Web Audio
  }

  // Méthode pour jouer l'audio sans élément audio visible
  play() {
    console.log("je suis dans play audio");
    if (!this.sourceNode) {
      // Créer un nouveau MediaStream uniquement avec la piste audio
      const stream = new MediaStream();

      stream.addTrack(this.track);

      // Créer un MediaStreamAudioSourceNode pour cette piste
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Connecter la source au contexte audio pour la sortie par défaut (haut-parleurs)
      this.sourceNode.connect(this.audioContext.destination);
    }

    // Commencer la lecture
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().then(() => {
        console.log("Playback resumed successfully");
      });
    }
  }

  // Méthode pour ajuster le volume (non applicable directement avec Web Audio, gestion via un gain node requise)
  setVolume(volumeLevel) {
    if (!this.gainNode) {
      // Créer un gain node si non existant
      this.gainNode = this.audioContext.createGain();
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
    }
    this.gainNode.gain.value = volumeLevel; // volumeLevel doit être entre 0.0 (muet) et 1.0 (maximum)
  }

  // Méthode pour activer/désactiver le son
  mute(muted) {
    this.setVolume(muted ? 0 : 1); // Set volume to 0 if muted, else restore volume
  }
}

class VideoTrackHandler {
  constructor(track) {
    this.track = track; // La piste MediaStreamTrack
    this.videoElement = null; // L'élément video qui sera créé
  }

  play(elementId) {
    // Créer et configurer l'élément vidéo si ce n'est pas déjà fait
    if (!this.videoElement) {
      this.videoElement = document.createElement("video");
      this.videoElement.autoplay = true; // Démarrage automatique de la vidéo
      this.videoElement.controls = false; // Ajouter des contrôles de lecture
      this.videoElement.style.width = "100%"; // Adaptez à la taille de votre conteneur
      this.videoElement.style.height = "100%"; // Adaptez à la taille de votre conteneur
      this.videoElement.style.borderRadius = "50%";

      // Créer un nouveau MediaStream et y ajouter la piste
      const stream = new MediaStream();
      stream.addTrack(this.track);

      // Attacher le stream à l'élément vidéo
      this.videoElement.srcObject = stream;

      // Ajouter l'élément vidéo au DOM
      const container = document.getElementById(elementId);
      if (container) {
        container.appendChild(this.videoElement);
      } else {
        console.error("No element found with ID:", elementId);
        return;
      }
    }

    // Jouer la vidéo
    this.videoElement
      .play()
      .catch((err) => console.error("Error playing video:", err));
  }
}

let uid = sessionStorage.getItem("uid");
if (!uid) {
  uid = String(Math.floor(Math.random() * 10000000));
  sessionStorage.setItem("uid", uid);

  console.log("uid : ", uid);
}

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
let roomName = urlParams.get("room");

if (!roomName) {
  // roomId = "main";
  window.location = "/";
}

let name = urlParams.get("name");

if (!name) {
  window.location = "/";
}

const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

// const roomName = window.location.pathname.split("/")[2];

// const name = "daulin";

const socket = io("/mediasoup");

socket.on("connection-success", ({ socketId }) => {
  console.log(socketId);
  getLocalStream();
});

// let displayFrame = document.getElementById("stream__box");
// let videoFrames = document.getElementsByClassName("video__container");
// let userIdInDisplayFrame = null;

let localTracks;
let localScreenTracks;
let sharingScreen = false;

let device;
let rtpCapabilities;
let producerTransport;
let consumerTransports = [];
let audioProducer;
let videoProducer;
let consumer;
let isProducer = false;

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
  // mediasoup params
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

let listUserRoom = [];

let audioParams;
let videoParams = { params };
let consumingTransports = [];

const streamSuccess = (stream) => {
  localTracks = stream;
  document.getElementById("join-btn").style.display = "none";
  document.getElementsByClassName("stream__actions")[0].style.display = "flex";

  // localVideo.srcObject = stream;

  let player = `<div class="video__container" id="user-container-${uid}">
  <div class="video-player" id="user-${uid}"></div>
</div>`;

  document
    .getElementById("streams__container")
    .insertAdjacentHTML("beforeend", player);
  document
    .getElementById(`user-container-${uid}`)
    .addEventListener("click", expandVideoFrame);

  audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
  videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

  const handler = new VideoTrackHandler(stream.getVideoTracks()[0]);
  handler.play(`user-${uid}`);

  console.log("audio de recuperation : ", stream.getAudioTracks()[0]);
  const handlera = new AudioTrackHandler(stream.getAudioTracks()[0]);
  handlera.play();

  joinRoom();
};

let getSizeArray = (array) => {
  return array.length;
};

let addMemberToDom = async (user) => {
  let membersWrapper = document.getElementById("member__list");
  let memberItem = `<div class="member__wrapper" id="member__${user.uid}__wrapper">
                      <span class="green__icon"></span>
                      <p class="member_name">${user.name}</p>
                  </div>`;

  membersWrapper.insertAdjacentHTML("beforeend", memberItem);
};

let updateMemberTotal = async (members) => {
  let total = document.getElementById("members__count");
  total.innerText = members.length;
};

let addBotMessageToDom = (botMessage) => {
  let messagesWrapper = document.getElementById("messages");

  let newMessage = `<div class="message__wrapper">
                      <div class="message__body__bot">
                          <strong class="message__author__bot">🤖 Mumble Bot</strong>
                          <p class="message__text__bot">${botMessage}</p>
                      </div>
                  </div>`;

  messagesWrapper.insertAdjacentHTML("beforeend", newMessage);

  let lastMessage = document.querySelector(
    "#messages .message__wrapper:last-child"
  );
  if (lastMessage) {
    lastMessage.scrollIntoView();
  }
};

let removeMemberFromDom = async (socketId) => {
  let memberWrapper = document.getElementById(`member__${socketId}__wrapper`);
  let name = memberWrapper.getElementsByClassName("member_name")[0].textContent;
  addBotMessageToDom(`${name} has left the room.`);

  memberWrapper.remove();
};

const displayMemberLeft = (array) => {
  array.forEach((user) => {
    addMemberToDom(user);
  });
};

const joinRoom = () => {
  socket.emit("joinRoom", { roomName, name, uid }, (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
    // we assign to local variable and will be used when
    // loading the client Device (see createDevice above)
    rtpCapabilities = data.rtpCapabilities;
    listUserRoom = data.listUserRoom;

    console.log("listUser", listUserRoom);

    if (listUserRoom.length >= 1) {
      updateMemberTotal(listUserRoom);
      displayMemberLeft(listUserRoom);
    }

    // once we have rtpCapabilities from the Router, create Device
    createDevice();
  });
};

const getLocalStream = () => {
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    })
    .then(streamSuccess)
    .catch((error) => {
      console.log(error.message);
    });
};

// A device is an endpoint connecting to a Router on the
// server side to send/recive media
const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();

    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
    // Loads the device with RTP capabilities of the Router (server side)
    await device.load({
      // see getRtpCapabilities() below
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log("Device RTP Capabilities", device.rtpCapabilities);

    // once the device loads, create transport
    createSendTransport();
  } catch (error) {
    console.log(error);
    if (error.name === "UnsupportedError")
      console.warn("browser not supported");
  }
};

const createSendTransport = () => {
  // see server's socket.on('createWebRtcTransport', sender?, ...)
  // this is a call from Producer, so sender = true
  socket.emit(
    "createWebRtcTransport",
    { consumer: false, uid },
    ({ params }) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      // creates a new WebRTC Transport to send media
      // based on the server's producer transport params
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      producerTransport = device.createSendTransport(params);

      // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
      // this event is raised when a first call to transport.produce() is made
      // see connectSendTransport() below
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-connect', ...)
            await socket.emit("transport-connect", {
              dtlsParameters,
              uid,
            });

            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            errback(error);
          }
        }
      );

      producerTransport.on("produce", async (parameters, callback, errback) => {
        console.log(parameters);

        try {
          // tell the server to create a Producer
          // with the following parameters and produce
          // and expect back a server side producer id
          // see server's socket.on('transport-produce', ...)
          await socket.emit(
            "transport-produce",
            {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
              uid,
            },
            ({ id, producersExist }) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              callback({ id });

              // if producers exist, then join room
              if (producersExist) getProducers();
            }
          );
        } catch (error) {
          errback(error);
        }
      });

      connectSendTransport();
    }
  );
};

const connectSendTransport = async () => {
  // we now call produce() to instruct the producer transport
  // to send media to the Router
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  // this action will trigger the 'connect' and 'produce' events above

  audioProducer = await producerTransport.produce(audioParams);
  videoProducer = await producerTransport.produce(videoParams);

  audioProducer.on("trackended", () => {
    console.log("audio track ended");

    // close audio track
  });

  audioProducer.on("transportclose", () => {
    console.log("audio transport ended");

    // close audio track
  });

  videoProducer.on("trackended", () => {
    console.log("video track ended");

    // close video track
  });

  videoProducer.on("transportclose", () => {
    console.log("video transport ended");

    // close video track
  });
};

const signalNewConsumerTransport = async (remoteProducerId) => {
  //check if we are already consuming the remoteProducerId
  if (consumingTransports.includes(remoteProducerId)) return;
  consumingTransports.push(remoteProducerId);

  await socket.emit(
    "createWebRtcTransport",
    { consumer: true, uid },
    ({ params }) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log(`PARAMS... ${params}`);

      let consumerTransport;
      try {
        consumerTransport = device.createRecvTransport(params);
      } catch (error) {
        // exceptions:
        // {InvalidStateError} if not loaded
        // {TypeError} if wrong arguments.
        console.log(error);
        return;
      }

      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-recv-connect', ...)
            await socket.emit("transport-recv-connect", {
              dtlsParameters,
              serverConsumerTransportId: params.id,
            });

            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            // Tell the transport that something was wrong
            errback(error);
          }
        }
      );

      connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    }
  );
};

// server informs the client of a new producer just joined
socket.on("new-producer", ({ producerId }) =>
  signalNewConsumerTransport(producerId)
);

socket.on("user joined", (user) => {
  listUserRoom.push(user);

  console.log("listUserroom User joined : ", listUserRoom);
  updateMemberTotal(listUserRoom);
  addMemberToDom(user);
});

const getProducers = () => {
  socket.emit("getProducers", { uid }, (producerIds) => {
    console.log(producerIds);
    // for each of the producer create a consumer
    // producerIds.forEach(id => signalNewConsumerTransport(id))
    producerIds.forEach(signalNewConsumerTransport);
  });
};

let handleUserPublished = async (track, remoteProducerId, mediaType) => {
  let player = document.getElementById(`user-container-${remoteProducerId}`);

  if (displayFrame.style.display) {
    let videoFrame = document.getElementById(
      `user-container-${remoteProducerId}`
    );
    videoFrame.style.height = "100px";
    videoFrame.style.width = "100px";
  }

  let handler;

  if (mediaType == "video") {
    // user.videoTrack.play(`user-${user.uid}`)
    if (player === null) {
      player = `<div class="video__container" id="user-container-${remoteProducerId}">
                <div class="video-player" id="user-${remoteProducerId}"></div>
            </div>`;

      document
        .getElementById("streams__container")
        .insertAdjacentHTML("beforeend", player);
      document
        .getElementById(`user-container-${remoteProducerId}`)
        .addEventListener("click", expandVideoFrame);
    }
    console.log("la video de reception donne affichage du track", track);
    console.log("vidoe mediaType :", mediaType);
    handler = new VideoTrackHandler(track);
    handler.play(`user-${remoteProducerId}`);
  }

  if (mediaType == "audio") {
    // user.audioTrack.play()

    console.log("l audio de reception donne affichage du track", track);
    console.log("audio mediaType :", mediaType);
    handler = new RemoteAudioPlayer(track);
    handler.play();
  }
};

const connectRecvTransport = async (
  consumerTransport,
  remoteProducerId,
  serverConsumerTransportId
) => {
  // for consumer, we need to tell the server first
  // to create a consumer based on the rtpCapabilities and consume
  // if the router can consume, it will send back a set of params as below
  await socket.emit(
    "consume",
    {
      rtpCapabilities: device.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
      uid,
    },
    async ({ params }) => {
      if (params.error) {
        console.log("Cannot Consume");
        return;
      }

      console.log(`Consumer Params ${params}`);
      // then consume with the local consumer transport
      // which creates a consumer
      const consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      const { track } = consumer;

      consumerTransports = [
        ...consumerTransports,
        {
          consumerTransport,
          serverConsumerTransportId: params.id,
          producerId: remoteProducerId,
          consumer,
        },
      ];
      handleUserPublished(track, remoteProducerId, params.kind);

      // create a new div element for the new consumer media
      // const newElem = document.createElement("div");
      // newElem.setAttribute("id", `td-${remoteProducerId}`);

      // if (params.kind == "audio") {
      //   //append to the audio container
      //   newElem.innerHTML =
      //     '<audio id="' + remoteProducerId + '" autoplay></audio>';
      // } else {
      //   //append to the video container
      //   newElem.setAttribute("class", "remoteVideo");
      //   newElem.innerHTML =
      //     '<video id="' +
      //     remoteProducerId +
      //     '" autoplay class="video" ></video>';
      // }

      // videoContainer.appendChild(newElem);

      // // destructure and retrieve the video track from the producer
      // const { track } = consumer;

      // console.log("track : ", track);

      // document.getElementById(remoteProducerId).srcObject = new MediaStream([
      //   track,
      // ]);

      // the server consumer started with media paused
      // so we need to inform the server to resume
      socket.emit("consumer-resume", {
        serverConsumerId: params.serverConsumerId,
      });
    }
  );
};

// User left
socket.on("leaveRoom", ({ uidDisconnet }) => {
  console.log("je suis deconnecte ");

  console.log("listCurrent : ", listUserRoom);

  console.log("uidDisconnet :  ", uidDisconnet);

  listUserRoom = listUserRoom.filter((user) => user.uid != uidDisconnet);
  updateMemberTotal(listUserRoom);
  removeMemberFromDom(uidDisconnet);

  console.log("listAfter : ", listUserRoom);
});

let handleUserLeft = async (remoteProducerId) => {
  let item = document.getElementById(`user-container-${remoteProducerId}`);
  if (item) {
    item.remove();
  }

  if (userIdInDisplayFrame === `user-container-${remoteProducerId}`) {
    displayFrame.style.display = null;

    let videoFrames = document.getElementsByClassName("video__container");

    for (let i = 0; videoFrames.length > i; i++) {
      videoFrames[i].style.height = "300px";
      videoFrames[i].style.width = "300px";
    }
  }
};

socket.on("producer-closed", ({ remoteProducerId }) => {
  // server notification is received when a producer is closed
  // we need to close the client-side consumer and associated transport
  const producerToClose = consumerTransports.find(
    (transportData) => transportData.producerId === remoteProducerId
  );
  producerToClose.consumerTransport.close();
  producerToClose.consumer.close();

  // remove the consumer transport from the list
  consumerTransports = consumerTransports.filter(
    (transportData) => transportData.producerId !== remoteProducerId
  );

  // remove the video div element
  // videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`));

  handleUserLeft(remoteProducerId);
});

let toggleScreen = async (e) => {
  let screenButton = e.currentTarget;
  let cameraButton = document.getElementById("camera-btn");

  if (!sharingScreen) {
    audioParams;
    videoParams = { params };
    sharingScreen = true;

    screenButton.classList.add("active");
    cameraButton.classList.remove("active");
    cameraButton.style.display = "none";

    getScreenShareStream();

    // localScreenTracks = await AgoraRTC.createScreenVideoTrack();

    // document.getElementById(`user-container-${uid}`).remove();
    // displayFrame.style.display = "block";

    // let player = `<div class="video__container" id="user-container-${uid}">
    //           <div class="video-player" id="user-${uid}"></div>
    //       </div>`;

    // displayFrame.insertAdjacentHTML("beforeend", player);
    // document
    //   .getElementById(`user-container-${uid}`)
    //   .addEventListener("click", expandVideoFrame);

    // userIdInDisplayFrame = `user-container-${uid}`;
    // localScreenTracks.play(`user-${uid}`);

    // await client.unpublish([localTracks[1]]);
    // await client.publish([localScreenTracks]);

    // let videoFrames = document.getElementsByClassName("video__container");
    // for (let i = 0; videoFrames.length > i; i++) {
    //   if (videoFrames[i].id != userIdInDisplayFrame) {
    //     videoFrames[i].style.height = "100px";
    //     videoFrames[i].style.width = "100px";
    //   }
    // }
  } else {
    sharingScreen = false;
    cameraButton.style.display = "block";
    document.getElementById(`user-container-${uid}`).remove();
    // await client.unpublish([localScreenTracks]);

    audioProducer.close();
    videoProducer.close();

    getLocalStreamShareScreem();
  }
};

let addMessageToDom = (name, message) => {
  let messagesWrapper = document.getElementById("messages");

  let newMessage = `<div class="message__wrapper">
                        <div class="message__body">
                            <strong class="message__author">${name}</strong>
                            <p class="message__text">${message}</p>
                        </div>
                    </div>`;

  messagesWrapper.insertAdjacentHTML("beforeend", newMessage);

  let lastMessage = document.querySelector(
    "#messages .message__wrapper:last-child"
  );
  if (lastMessage) {
    lastMessage.scrollIntoView();
  }
};

let sendMessage = async (e) => {
  e.preventDefault();

  console.log("je suis en  train d ecrire");

  let message = e.target.message.value;

  console.log("message  : ", message);
  socket.emit("sendMessage", {
    text: {
      uid,
      roomName,
      type: "chat",
      message: message,
      displayName: name,
    },
  });
  addMessageToDom(name, message);
  e.target.reset();
};

socket.on("sendMessage", (data) => {
  console.log("data.ext :", data);
  addMessageToDom(data.name, data.message);
});

// let switchToCamera = async () => {
//   let player = `<div class="video__container" id="user-container-${uid}">
//                   <div class="video-player" id="user-${uid}"></div>
//                </div>`;
//   displayFrame.insertAdjacentHTML("beforeend", player);

//   // await localTracks[0].setMuted(true);
//   // await localTracks[1].setMuted(true);

//   document.getElementById("mic-btn").classList.remove("active");
//   document.getElementById("screen-btn").classList.remove("active");

//   localTracks[1].play(`user-${uid}`);
//   await client.publish([localTracks[1]]);
// };

let toggleMic = async (e) => {
  console.log("bonjour");
  let button = e.currentTarget;

  if (audioParams.track.enabled) {
    // await audioParams.track.setMuted(false);
    audioParams.track.enabled = false;
    button.classList.add("active");
  } else {
    // await audioParams.track.setMuted(true);
    audioParams.track.enabled = true;
    button.classList.remove("active");
  }
};

let toggleCamera = async (e) => {
  let button = e.currentTarget;

  if (videoParams.track.enabled) {
    // await videoParams.track.setMuted(false);
    videoParams.track.enabled = false;
    button.classList.add("active");
  } else {
    // await videoParams.track.setMuted(true);
    videoParams.track.enabled = true;
    button.classList.remove("active");
  }
};

let joinStream = async () => {
  document.getElementById("join-btn").style.display = "none";
  document.getElementsByClassName("stream__actions")[0].style.display = "flex";

  // let player = `<div class="video__container" id="user-container-${uid}">
  //                 <div class="video-player" id="user-${uid}"></div>
  //              </div>`;

  // document
  //   .getElementById("streams__container")
  //   .insertAdjacentHTML("beforeend", player);
  // document
  //   .getElementById(`user-container-${uid}`)
  //   .addEventListener("click", expandVideoFrame);

  // localTracks[1].play(`user-${uid}`);
  // await client.publish([localTracks[0], localTracks[1]]);

  getLocalStream();
};

const leaveStream = () => {
  // producerTransport.close();

  audioProducer.close();
  videoProducer.close();

  const video__container = document.querySelectorAll(".video__container");

  console.log("video__contaiener : ", video__container);

  video__container.forEach((element) => {
    element.remove();
  });

  // consumerTransports.forEach(async (transportData) => {
  //   await transportData.consumerTransport.close();
  //   await transportData.consumer.close();
  // });
  // producerToClose.consumerTransport.close();
  // producerToClose.consumer.close();

  // remove the consumer transport from the list
  sessionStorage.clear();

  consumerTransports = [];
  socket.close();
  window.location = "/";
};

const getScreenShareStream = () => {
  navigator.mediaDevices
    .getDisplayMedia({
      video: {
        cursor: "always", // Options: "always", "motion", "never"
      },
      audio: true, // Capture aussi l'audio du système si possible et autorisé
    })
    .then((stream) => {
      audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
      videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

      document.getElementById(`user-container-${uid}`).remove();
      displayFrame.style.display = "block";

      let player = `<div class="video__container" id="user-container-${uid}">
                <div class="video-player" id="user-${uid}"></div>
            </div>`;

      displayFrame.insertAdjacentHTML("beforeend", player);
      document
        .getElementById(`user-container-${uid}`)
        .addEventListener("click", expandVideoFrame);

      userIdInDisplayFrame = `user-container-${uid}`;
      // localScreenTracks.play(`user-${uid}`);

      const handler = new VideoTrackHandler(stream.getVideoTracks()[0]);
      handler.play(`user-${uid}`);

      producerTransport.close();

      connectSendTransport();

      // await client.unpublish([localTracks[1]]);
      // await client.publish([localScreenTracks]);

      let videoFrames = document.getElementsByClassName("video__container");
      for (let i = 0; videoFrames.length > i; i++) {
        if (videoFrames[i].id != userIdInDisplayFrame) {
          videoFrames[i].style.height = "100px";
          videoFrames[i].style.width = "100px";
        }
      }
    })
    .catch((error) => {
      console.log("Failed to get screen stream: ", error.message);
    });
};

const getLocalStreamShareScreem = () => {
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    })
    .then(switchToCameraSuc)
    .catch((error) => {
      console.log(error.message);
    });
};

const switchToCameraSuc = (stream) => {
  let player = `<div class="video__container" id="user-container-${uid}">
  <div class="video-player" id="user-${uid}"></div>
</div>`;
  displayFrame.insertAdjacentHTML("beforeend", player);

  // await localTracks[0].setMuted(true);
  // await localTracks[1].setMuted(true);

  document.getElementById("mic-btn").classList.remove("active");
  document.getElementById("screen-btn").classList.remove("active");

  audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
  videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

  const handler = new VideoTrackHandler(stream.getVideoTracks()[0]);
  handler.play(`user-${uid}`);

  connectSendTransport();
};

document.getElementById("camera-btn").addEventListener("click", toggleCamera);
document.getElementById("mic-btn").addEventListener("click", toggleMic);
document.getElementById("join-btn").addEventListener("click", joinStream);
document.getElementById("screen-btn").addEventListener("click", toggleScreen);
document.getElementById("leave-btn").addEventListener("click", leaveStream);

let messageForm = document.getElementById("message__form");
messageForm.addEventListener("submit", sendMessage);
