import { HandLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const estadoTexto = document.getElementById('estado-texto');

let handLandmarker = null;
let ultimoEstado = {};

// --- 1. Inicializar MediaPipe para 2 MANOS ---
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
    numHands: 2, // <--- CLAVE: Ahora detecta hasta 2 manos [citation:1]
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  console.log("MediaPipe listo para 2 manos");
}

// --- 2. Abrir cámara ---
async function iniciarCamara() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 }
  });
  video.srcObject = stream;
  await video.play();
}

// --- 3. FUNCIÓN PARA CALCULAR ÁNGULOS ---
// Calcula el ángulo (en grados) entre 3 puntos (A, B, C) donde B es el vértice
function calcularAngulo(pA, pB, pC) {
    // Vectores BA y BC
    const ba = { x: pA.x - pB.x, y: pA.y - pB.y, z: pA.z - pB.z };
    const bc = { x: pC.x - pB.x, y: pC.y - pB.y, z: pC.z - pB.z };

    // Producto punto y magnitudes
    const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
    const magBA = Math.sqrt(ba.x**2 + ba.y**2 + ba.z**2);
    const magBC = Math.sqrt(bc.x**2 + bc.y**2 + bc.z**2);

    if (magBA === 0 || magBC === 0) return 0;

    // Cálculo del ángulo
    let angleRad = Math.acos(dot / (magBA * magBC));
    let angleDeg = angleRad * (180 / Math.PI);
    
    // Ajuste: Si el ángulo es muy agudo (dedo doblado), invertimos para que sea más intuitivo (0 = abierto, 180 = cerrado)
    // Dependiendo de la geometría de tu mano, a veces un dedo recto da ~180°.
    // Si quieres que "cerrado" sea 0°, puedes hacer: return 180 - angleDeg; 
    return angleDeg; 
}

// --- 4. Lógica para procesar CADA mano ---
function procesarMano(landmarks, index) {
    // Landmarks clave para cada dedo (índice, medio, anular, meñique)
    // Usamos (PIP, DIP, TIP) para el ángulo de flexión
    const dedos = {
        'Índice': { p1: 6, p2: 7, p3: 8 },   // MCP, PIP, TIP (simplificado)
        'Medio':  { p1: 10, p2: 11, p3: 12 },
        'Anular': { p1: 14, p2: 15, p3: 16 },
        'Meñique':{ p1: 18, p2: 19, p3: 20 }
    };

    let angulos = {};
    for (const [nombre, pts] of Object.entries(dedos)) {
        // Calculamos el ángulo en la articulación media (PIP) usando el nudillo (MCP) y la punta (TIP)
        angulos[nombre] = Math.round(calcularAngulo(landmarks[pts.p1], landmarks[pts.p2], landmarks[pts.p3]));
    }

    // --- Lógica de estado (Abierto/Cerrado) ---
    // Si el promedio de los ángulos de los dedos es menor a cierto umbral, está cerrado.
    // Nota: Ajusta este umbral. Si tus dedos rectos dan ~180°, entonces < 90° es muy cerrado.
    const promedioAngulos = (angulos['Índice'] + angulos['Medio'] + angulos['Anular'] + angulos['Meñique']) / 4;
    
    // Si el promedio es bajo (dedos doblados), consideramos "Cerrado"
    const estaCerrada = promedioAngulos < 100; // Ajusta este valor según pruebes

    // Actualizar UI (solo si cambió el estado para no saturar)
    if (ultimoEstado[index] !== estaCerrada) {
        ultimoEstado[index] = estaCerrada;
        console.log(`Mano ${index + 1}: ${estaCerrada ? 'CERRADA' : 'ABIERTA'} | Ángulos:`, angulos);
        
        // Aquí enviarías los datos al ESP32. Ejemplo:
        // enviarComando(index, estaCerrada ? 'C' : 'A');
        // O enviar los ángulos: enviarAngulos(index, angulos);
    }

    return { estaCerrada, angulos, promedioAngulos };
}

// --- 5. Bucle de detección ---
function detectar() {
  if (!handLandmarker || !video.videoWidth) {
    requestAnimationFrame(detectar);
    return;
  }

  const startTimeMs = performance.now();
  const results = handLandmarker.detectForVideo(video, startTimeMs);

  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Actualizar el texto de estado general
  if (results.landmarks && results.landmarks.length > 0) {
    estadoTexto.textContent = `Detectadas: ${results.landmarks.length} mano(s)`;
    
    // Recorremos cada mano detectada (hasta 2)
    results.landmarks.forEach((landmarks, index) => {
        // Dibujar esqueleto
        const drawingUtils = new DrawingUtils(ctx);
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
            color: index === 0 ? "#00FF00" : "#FF00FF", // Verde para la 1, Magenta para la 2
            lineWidth: 3
        });
        drawingUtils.drawLandmarks(landmarks, {
            color: "#FF0000",
            radius: 3
        });

        // Procesar ángulos y estado
        const infoMano = procesarMano(landmarks, index);
        
        // (Opcional) Mostrar los ángulos en el canvas
        // ctx.fillStyle = "white";
        // ctx.font = "16px Arial";
        // ctx.fillText(`M${index+1} Prom: ${Math.round(infoMano.promedioAngulos)}°`, 10, 30 + (index * 20));
    });

  } else {
    estadoTexto.textContent = "Esperando manos...";
    ultimoEstado = {}; // Resetear estados
  }

  requestAnimationFrame(detectar);
}

// --- 6. Iniciar todo ---
async function iniciar() {
  try {
    await iniciarCamara();
    await inicializarMediaPipe();
    detectar();
  } catch (error) {
    console.error("Error:", error);
    estadoTexto.textContent = "Error: " + error.message;
  }
}

iniciar();
