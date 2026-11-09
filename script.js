import { HandLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const estadoTexto = document.getElementById('estado-texto');

let handLandmarker = null;
let running = false;
let ultimoEstado = null;

// --- 1. Inicializar MediaPipe ---
async function inicializarMediaPipe() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.7,
    minHandPresenceConfidence: 0.7,
    minTrackingConfidence: 0.7
  });

  console.log("MediaPipe listo");
}

// --- 2. Abrir cámara ---
async function iniciarCamara() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 }
  });
  video.srcObject = stream;
  await video.play();
  console.log("Cámara lista");
}

// --- 3. Lógica para saber si la mano está cerrada ---
// Usamos los landmarks: si la punta de los dedos está "más abajo" que el nudillo, está doblado
function manoEstaCerrada(landmarks) {
  // Landmarks clave: índice (8=punta, 6=nudillo), medio (12=punta, 10=nudillo)
  const indiceDoblado = landmarks[8].y > landmarks[6].y;
  const medioDoblado = landmarks[12].y > landmarks[10].y;
  
  // Consideramos cerrada si al menos 2 dedos están doblados
  return indiceDoblado && medioDoblado;
}

// --- 4. Bucle de detección ---
function detectar() {
  if (!handLandmarker || !video.videoWidth) {
    requestAnimationFrame(detectar);
    return;
  }

  const startTimeMs = performance.now();
  const results = handLandmarker.detectForVideo(video, startTimeMs);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Ajustar tamaño del canvas al video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  if (results.landmarks && results.landmarks.length > 0) {
    const landmarks = results.landmarks[0];

    // Dibujar esqueleto de la mano
    const drawingUtils = new DrawingUtils(ctx);
    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00FF00",
      lineWidth: 3
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: "#FF0000",
      radius: 4
    });

    // Clasificar estado
    const cerrada = manoEstaCerrada(landmarks);
    const estadoActual = cerrada ? "CERrada" : "ABIERTA";

    // Actualizar UI solo si cambió
    if (estadoActual !== ultimoEstado) {
      estadoTexto.textContent = `Mano ${estadoActual}`;
      estadoTexto.style.color = cerrada ? "#e94560" : "#00d9ff";
      
      // Aquí luego enviaremos el comando al ESP32
      // enviarComando(cerrada ? 'C' : 'A');
      
      ultimoEstado = estadoActual;
    }
  } else {
    estadoTexto.textContent = "Esperando mano...";
    estadoTexto.style.color = "#888";
    ultimoEstado = null;
  }

  requestAnimationFrame(detectar);
}

// --- 5. Iniciar todo ---
async function iniciar() {
  try {
    await iniciarCamara();
    await inicializarMediaPipe();
    running = true;
    detectar();
    console.log("Sistema iniciado");
  } catch (error) {
    console.error("Error:", error);
    estadoTexto.textContent = "Error: " + error.message;
  }
}

iniciar();