import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// --- VARIABLES GLOBALES ---
let scene, camera, renderer, controls, clock;
let player = null;
let mixer = null;
const actions = {};
let activeAction = null;

// Control de movimiento fluido y estado del personaje
const keys = { w: false, s: false, a: false, d: false, shift: false };
let currentSpeed = 0;
let targetRotationY = 0;
let isJumping = false;
let isAttacking = false;

// Zoom gradual controlado por la rueda del ratón
let targetZoomDistance = 8.5;
let currentZoomDistance = 8.5;

// Escenario 100x100 unidades
const MAP_LIMIT = 46;
const PLAYER_RADIUS = 0.65;

// Objetos 3D con física y fragmentos de destrucción
const staticObstacles = []; // Rocas rúnicas y troncos de árboles (colisión sólida)
const dynamicObjects = [];  // Barriles/troncos (empujables y rompibles)
const debrisPieces = [];    // Pedazos que salen volando al romper algo

// Elementos ambientales animados (animales, fuego y luces)
const animatedAnimals = []; // Cuervos volando y ovejas pastando
const fireParticles = [];   // Chispas y llamas de la fogata
let torchLight = null;

init();
animate();

function init() {
    clock = new THREE.Clock();
    const container = document.getElementById('canvas-container');

    // 1. ESCENA Y NIEBLA GRIS CLARA
    scene = new THREE.Scene();
    const fogColor = 0xd3d3d3;
    scene.background = new THREE.Color(fogColor);
    scene.fog = new THREE.Fog(fogColor, 26, 98);

    // 2. CÁMARA Y CONTROLES DE RATÓN
    camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 250);
    camera.position.set(0, 4.2, 8.5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.target.set(0, 1.4, 0);

    // Control gradual de rueda del ratón
    renderer.domElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = Math.sign(e.deltaY) * 1.1;
        targetZoomDistance = THREE.MathUtils.clamp(targetZoomDistance + step, 2.5, 28);
    }, { passive: false });

    // 3. AMBIENTE 360° HDR
    const rgbeLoader = new RGBELoader();
    rgbeLoader.load('assets/textures/entorno.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
        scene.background = texture;
    });

    // 4. ILUMINACIÓN DEL ESCENARIO
    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x3a3228, 0.85);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e4, 2.2);
    sunLight.position.set(25, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 115;
    const d = 52;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    torchLight = new THREE.PointLight(0xff6b1a, 6, 18);
    torchLight.position.set(-4.5, 1.8, -4.5);
    scene.add(torchLight);

    // 5. SUELO, MONTAÑAS, BOSQUE, FOGATA Y VEGETACIÓN
    createEnvironment();

    // 6. ANIMALES VIVOS (CUERVOS Y OVEJAS NÓRDICAS)
    createWildlife();

    // 7. OBJETOS 3D DESTRUCTIBLES Y CON FÍSICAS
    createPhysicsObjects();

    // 8. PERSONAJE VIKINGO Y ANIMACIONES
    loadVikingCharacter();

    // 9. EVENTOS DE TECLADO, RATÓN Y VENTANA
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onWindowResize);
}

function createEnvironment() {
    // --- A. SUELO TEXTURIZADO ---
    const texLoader = new THREE.TextureLoader();
    const groundTex = texLoader.load('assets/textures/suelo_diff.jpg');
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(28, 28);
    groundTex.colorSpace = THREE.SRGBColorSpace;

    const groundGeo = new THREE.PlaneGeometry(130, 130);
    const groundMat = new THREE.MeshStandardMaterial({
        map: groundTex,
        roughness: 0.85,
        metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- B. CORDILLERA DE MONTAÑAS NEVADAS AL FONDO ---
    const mountainRockMat = new THREE.MeshStandardMaterial({ color: 0x475059, roughness: 0.95, flatShading: true });
    const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xeef4f8, roughness: 0.7, flatShading: true });
    const mountainCount = 26;

    for (let i = 0; i < mountainCount; i++) {
        const angle = (i / mountainCount) * Math.PI * 2;
        const dist = 62 + (i % 3) * 5;
        const height = 18 + (i % 4) * 6;
        const radius = 12 + (i % 3) * 4;

        const mGroup = new THREE.Group();
        const baseCone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), mountainRockMat);
        baseCone.position.y = height / 2;
        mGroup.add(baseCone);

        // Pico nevado superior
        const snowCone = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.42, height * 0.42, 7), snowCapMat);
        snowCone.position.y = height * 0.79;
        mGroup.add(snowCone);

        mGroup.position.set(Math.cos(angle) * dist, -0.5, Math.sin(angle) * dist);
        mGroup.rotation.y = i * 0.7;
        scene.add(mGroup);
    }

    // --- C. EMPALIZADA VIKINGA DE FRONTERA ---
    const postGeo = new THREE.CylinderGeometry(0.22, 0.28, 2.3, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.9 });
    const limit = MAP_LIMIT + 1.2;

    for (let i = -limit; i <= limit; i += 4.5) {
        const positions = [
            [i, 1.15, -limit],
            [i, 1.15, limit],
            [-limit, 1.15, i],
            [limit, 1.15, i]
        ];
        positions.forEach(([x, y, z]) => {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(x, y, z);
            post.castShadow = true;
            post.receiveShadow = true;
            scene.add(post);
        });
    }

    // --- D. BOSQUE DE PINOS NÓRDICOS (42 ÁRBOLES) ---
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2718, roughness: 0.9 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x243e2c, roughness: 0.85, flatShading: true });

    const treePositions = [
        // Árboles interiores (con colisión en el tronco)
        { x: -16, z: -15, solid: true }, { x: 18, z: -14, solid: true },
        { x: -18, z: 16,  solid: true }, { x: 16, z: 18,  solid: true },
        { x: -28, z: -8,  solid: true }, { x: 29, z: 6,   solid: true },
        { x: 6,   z: -28, solid: true }, { x: -7, z: 30,  solid: true },
        { x: -32, z: 25,  solid: true }, { x: 31, z: -26, solid: true },
        { x: 34,  z: 28,  solid: true }, { x: -35, z: -30, solid: true }
    ];

    // Añadir 30 pinos extra alrededor del borde exterior (bosque denso al fondo)
    for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const r = 49 + (i % 3) * 2.5;
        treePositions.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, solid: false });
    }

    treePositions.forEach((t, idx) => {
        const scale = 0.85 + (idx % 4) * 0.22;
        const treeGroup = new THREE.Group();

        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 2.4, 7), trunkMat);
        trunk.position.y = 1.2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeGroup.add(trunk);

        // 3 niveles de follaje cónico
        for (let level = 0; level < 3; level++) {
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(1.9 - level * 0.42, 2.5 - level * 0.3, 7),
                leavesMat
            );
            cone.position.y = 2.8 + level * 1.45;
            cone.castShadow = true;
            treeGroup.add(cone);
        }

        treeGroup.scale.setScalar(scale);
        treeGroup.position.set(t.x, 0, t.z);
        scene.add(treeGroup);

        if (t.solid) {
            staticObstacles.push({
                mesh: treeGroup,
                radius: 0.55 * scale,
                color: 0x3b2718,
                indestructible: true // Los árboles grandes sirven de cobertura sólida
            });
        }
    });

    // --- E. FOGATA VIKINGA EN (-4.5, 0, -4.5) ---
    const campPos = new THREE.Vector3(-4.5, 0, -4.5);
    const campStoneMat = new THREE.MeshStandardMaterial({ color: 0x4b5259, roughness: 0.9 });
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), campStoneMat);
        stone.position.set(campPos.x + Math.cos(a) * 0.95, 0.15, campPos.z + Math.sin(a) * 0.95);
        stone.castShadow = true;
        scene.add(stone);
    }
    // Leños cruzados
    for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6), trunkMat);
        log.position.set(campPos.x, 0.18, campPos.z);
        log.rotation.z = Math.PI / 2.4;
        log.rotation.y = (i * Math.PI) / 3;
        scene.add(log);
    }
    // Partículas de fuego animadas
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7b00 });
    for (let i = 0; i < 14; i++) {
        const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), flameMat);
        flame.position.set(campPos.x, 0.3 + Math.random() * 0.8, campPos.z);
        scene.add(flame);
        fireParticles.push({
            mesh: flame,
            baseX: campPos.x,
            baseZ: campPos.z,
            speed: 1.2 + Math.random() * 1.4,
            offset: Math.random() * Math.PI * 2
        });
    }

    // --- F. RUIDO VISUAL: 90 MATAS DE PASTO / ARBUSTOS BAJOS ---
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3b5231, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 90; i++) {
        const bx = (Math.sin(i * 19.3) * 0.5) * 86;
        const bz = (Math.cos(i * 27.7) * 0.5) * 86;
        if (Math.hypot(bx, bz) < 3) continue; // Dejar despejado el centro

        const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (i % 3) * 0.12, 0), bushMat);
        bush.scale.set(1.2, 0.65, 1.2);
        bush.position.set(bx, 0.14, bz);
        bush.rotation.y = i;
        bush.receiveShadow = true;
        scene.add(bush);
    }
}

function createWildlife() {
    // --- A. 5 CUERVOS DE ODÍN VOLANDO EN CÍRCULOS EN LO ALTO ---
    const crowMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
        const crowGroup = new THREE.Group();

        const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 5), crowMat);
        body.rotation.x = Math.PI / 2;
        crowGroup.add(body);

        const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.18), crowMat);
        leftWing.position.set(-0.22, 0, 0);
        crowGroup.add(leftWing);

        const rightWing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.18), crowMat);
        rightWing.position.set(0.22, 0, 0);
        crowGroup.add(rightWing);

        scene.add(crowGroup);
        animatedAnimals.push({
            type: 'crow',
            group: crowGroup,
            leftWing,
            rightWing,
            angle: (i / 5) * Math.PI * 2,
            radius: 12 + i * 3.5,
            height: 9 + (i % 3) * 2.2,
            speed: 0.35 + (i % 2) * 0.1
        });
    }

    // --- B. 4 OVEJAS NÓRDICAS PASTANDO EN EL CAMPO ---
    const woolMat = new THREE.MeshStandardMaterial({ color: 0xdfd9ce, roughness: 0.95, flatShading: true });
    const darkSkinMat = new THREE.MeshStandardMaterial({ color: 0x2b2623, roughness: 0.8 });
    const sheepLocations = [
        { x: 14, z: 12 },
        { x: -16, z: 11 },
        { x: 18, z: -18 },
        { x: -24, z: -12 }
    ];

    sheepLocations.forEach((loc, idx) => {
        const sheep = new THREE.Group();

        // Cuerpo lanudo
        const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), woolMat);
        body.scale.set(0.85, 0.85, 1.25);
        body.position.y = 0.68;
        body.castShadow = true;
        sheep.add(body);

        // Cabeza
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.42), darkSkinMat);
        head.position.set(0, 0.82, 0.68);
        head.castShadow = true;
        sheep.add(head);

        // 4 Patas
        const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6);
        [[-0.22, 0.35], [0.22, 0.35], [-0.22, -0.35], [0.22, -0.35]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(legGeo, darkSkinMat);
            leg.position.set(lx, 0.22, lz);
            sheep.add(leg);
        });

        sheep.position.set(loc.x, 0, loc.z);
        sheep.rotation.y = idx * 1.5;
        scene.add(sheep);

        animatedAnimals.push({
            type: 'sheep',
            group: sheep,
            head: head,
            originX: loc.x,
            originZ: loc.z,
            phase: idx * 1.7
        });
    });
}

function createPhysicsObjects() {
    // --- A. ROCAS RÚNICAS ESTÁTICAS (Rompibles con golpe) ---
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5c636a, roughness: 0.9, flatShading: true });
    const rockCoords = [
        { x: -8,  z: -7,  r: 1.5 },
        { x: 9,   z: -9,  r: 1.7 },
        { x: -10, z: 8,   r: 1.4 },
        { x: 10,  z: 7,   r: 1.6 },
        { x: -22, z: -18, r: 1.8 },
        { x: 24,  z: -20, r: 1.6 },
        { x: -20, z: 22,  r: 1.5 },
        { x: 22,  z: 24,  r: 1.9 }
    ];

    rockCoords.forEach((data) => {
        const rockGeo = new THREE.DodecahedronGeometry(data.r, 1);
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(data.x, data.r * 0.75, data.z);
        rock.castShadow = true;
        rock.receiveShadow = true;
        scene.add(rock);

        staticObstacles.push({
            mesh: rock,
            radius: data.r * 0.95,
            color: 0x5c636a
        });
    });

    // --- B. TRONCOS / BARRILES DINÁMICOS (Empujables y rompibles con golpe) ---
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7c4d2b, roughness: 0.7 });
    const barrelCoords = [
        { x: 3.0,   z: 3.0 },
        { x: -3.0,  z: 3.5 },
        { x: 12.0,  z: -3.0 },
        { x: -14.0, z: -11.0 },
        { x: 5.0,   z: 16.0 }
    ];

    barrelCoords.forEach((data) => {
        const radius = 0.55;
        const height = 1.2;
        const barrelGeo = new THREE.CylinderGeometry(radius, radius, height, 16);
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.position.set(data.x, height / 2, data.z);
        barrel.castShadow = true;
        barrel.receiveShadow = true;
        scene.add(barrel);

        dynamicObjects.push({
            mesh: barrel,
            radius: radius,
            velocity: new THREE.Vector3(0, 0, 0),
            color: 0x7c4d2b
        });
    });
}

function loadVikingCharacter() {
    const loader = new FBXLoader();

    loader.load('assets/models/vikingo.fbx', (fbx) => {
        player = fbx;
        player.scale.setScalar(0.011);
        player.position.set(0, 0, 0);

        player.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        scene.add(player);
        mixer = new THREE.AnimationMixer(player);

        const animFiles = [
            { name: 'walk',  path: 'assets/models/Walking.fbx',         loop: true },
            { name: 'run',   path: 'assets/models/Fast Run.fbx',        loop: true },
            { name: 'jump',  path: 'assets/models/Jumping Down.fbx',    loop: false },
            { name: 'punch', path: 'assets/models/Zombie Punching.fbx', loop: false }
        ];

        let loadedCount = 0;
        animFiles.forEach((item) => {
            loader.load(item.path, (animFbx) => {
                const clip = animFbx.animations[0];
                const action = mixer.clipAction(clip);

                if (!item.loop) {
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                }

                actions[item.name] = action;
                loadedCount++;

                if (loadedCount === animFiles.length) {
                    actions['walk'].play();
                    actions['walk'].paused = true;
                    activeAction = actions['walk'];

                    const loaderScreen = document.getElementById('loader');
                    loaderScreen.style.opacity = '0';
                    setTimeout(() => loaderScreen.style.display = 'none', 500);
                }
            });
        });

        mixer.addEventListener('finished', (e) => {
            if (e.action === actions['jump']) {
                isJumping = false;
                updateMovementAnimation();
            }
            if (e.action === actions['punch']) {
                isAttacking = false;
                updateMovementAnimation();
            }
        });
    });
}

function switchAnimation(name, duration = 0.22, timeScale = 1.0) {
    const nextAction = actions[name];
    if (!nextAction) return;

    nextAction.paused = false;
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1);

    if (activeAction === nextAction) return;

    nextAction.reset();
    if (activeAction) {
        nextAction.crossFadeFrom(activeAction, duration, true);
    }
    nextAction.play();
    activeAction = nextAction;
}

function updateMovementAnimation() {
    if (isJumping || isAttacking || !actions['walk']) return;

    if (keys.w) {
        switchAnimation(keys.shift ? 'run' : 'walk', 0.22, 1.0);
    } else if (keys.s) {
        switchAnimation('walk', 0.22, -0.8);
    } else {
        switchAnimation('walk', 0.25, 1.0);
        actions['walk'].time = 0;
        actions['walk'].paused = true;
    }
}

// --- SISTEMA DE GOLPE Y DESTRUCCIÓN ---
function triggerAttack() {
    if (!player || isAttacking || isJumping || !actions['punch']) return;

    isAttacking = true;
    switchAnimation('punch', 0.12, 1.35);

    setTimeout(() => {
        if (!player) return;

        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y);
        const hitPoint = player.position.clone().addScaledVector(forward, 1.6);

        // 1. Verificar si golpea alguna piedra rompible
        for (let i = staticObstacles.length - 1; i >= 0; i--) {
            const obs = staticObstacles[i];
            if (obs.indestructible) continue; // Los pinos gigantes no se destruyen

            const dist = Math.hypot(hitPoint.x - obs.mesh.position.x, hitPoint.z - obs.mesh.position.z);
            if (dist <= obs.radius + 1.2) {
                shatterObject(obs.mesh.position, obs.color, 18, 0.35);
                scene.remove(obs.mesh);
                staticObstacles.splice(i, 1);
            }
        }

        // 2. Verificar si golpea algún tronco/barril dinámico
        for (let i = dynamicObjects.length - 1; i >= 0; i--) {
            const bar = dynamicObjects[i];
            const dist = Math.hypot(hitPoint.x - bar.mesh.position.x, hitPoint.z - bar.mesh.position.z);
            if (dist <= bar.radius + 1.2) {
                shatterObject(bar.mesh.position, bar.color, 14, 0.22);
                scene.remove(bar.mesh);
                dynamicObjects.splice(i, 1);
            }
        }
    }, 320);
}

function shatterObject(origin, colorHex, count, size) {
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.85, flatShading: true });

    for (let i = 0; i < count; i++) {
        const piece = new THREE.Mesh(geo, mat);
        piece.position.set(
            origin.x + (Math.random() - 0.5) * 0.8,
            origin.y + Math.random() * 0.6,
            origin.z + (Math.random() - 0.5) * 0.8
        );
        piece.castShadow = true;
        scene.add(piece);

        debrisPieces.push({
            mesh: piece,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 9,
                3 + Math.random() * 5,
                (Math.random() - 0.5) * 9
            ),
            rotSpeed: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
            life: 2.2
        });
    }
}

// --- CONTROLES DE TECLADO Y RATÓN ---
function onKeyDown(e) {
    if (!player) return;
    const code = e.code;

    if (code === 'KeyW' || code === 'ArrowUp') {
        if (!keys.w) {
            keys.w = true;
            updateMovementAnimation();
        }
    }
    if (code === 'KeyS' || code === 'ArrowDown') {
        if (!keys.s) {
            keys.s = true;
            updateMovementAnimation();
        }
    }
    if (code === 'KeyA') keys.a = true;
    if (code === 'KeyD') keys.d = true;

    if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if (!keys.shift) {
            keys.shift = true;
            updateMovementAnimation();
        }
    }

    if (!e.repeat) {
        if (code === 'KeyQ' || code === 'ArrowLeft') targetRotationY += Math.PI / 2;
        if (code === 'KeyE' || code === 'ArrowRight') targetRotationY -= Math.PI / 2;

        if (code === 'Space' && !isJumping && !isAttacking && actions['jump']) {
            isJumping = true;
            switchAnimation('jump', 0.15, 1.0);
        }

        if (code === 'KeyF') {
            triggerAttack();
        }
    }
}

function onKeyUp(e) {
    const code = e.code;

    if (code === 'KeyW' || code === 'ArrowUp') {
        keys.w = false;
        updateMovementAnimation();
    }
    if (code === 'KeyS' || code === 'ArrowDown') {
        keys.s = false;
        updateMovementAnimation();
    }
    if (code === 'KeyA') keys.a = false;
    if (code === 'KeyD') keys.d = false;

    if (code === 'ShiftLeft' || code === 'ShiftRight') {
        keys.shift = false;
        updateMovementAnimation();
    }
}

let pointerDownPos = { x: 0, y: 0 };
function onPointerDown(e) {
    if (e.button === 0) {
        pointerDownPos = { x: e.clientX, y: e.clientY };
        const onPointerUp = (upEvent) => {
            const moved = Math.hypot(upEvent.clientX - pointerDownPos.x, upEvent.clientY - pointerDownPos.y);
            if (moved < 5) triggerAttack();
            window.removeEventListener('pointerup', onPointerUp);
        };
        window.addEventListener('pointerup', onPointerUp);
    }
}

// --- ANIMACIÓN DE FAUNA Y FOGATA ---
function updateEnvironmentAnimations(elapsedTime, delta) {
    // 1. Parpadeo de la luz de fogata y llamas subiendo
    if (torchLight) {
        torchLight.intensity = 5.5 + Math.sin(elapsedTime * 14) * 1.3;
    }
    fireParticles.forEach((fp) => {
        const cycle = (elapsedTime * fp.speed + fp.offset) % 1;
        fp.mesh.position.y = 0.25 + cycle * 1.1;
        fp.mesh.position.x = fp.baseX + Math.sin(elapsedTime * 6 + fp.offset) * 0.15 * (1 - cycle);
        fp.mesh.position.z = fp.baseZ + Math.cos(elapsedTime * 6 + fp.offset) * 0.15 * (1 - cycle);
        fp.mesh.scale.setScalar(1 - cycle * 0.7);
    });

    // 2. Cuervos volando y ovejas pastando
    animatedAnimals.forEach((animal) => {
        if (animal.type === 'crow') {
            animal.angle += animal.speed * delta;
            const nx = Math.cos(animal.angle) * animal.radius;
            const nz = Math.sin(animal.angle) * animal.radius;
            animal.group.position.set(nx, animal.height + Math.sin(elapsedTime * 2 + animal.angle) * 0.5, nz);
            animal.group.rotation.y = -animal.angle;

            // Aleteo
            const flap = Math.sin(elapsedTime * 11 + animal.angle) * 0.55;
            animal.leftWing.rotation.z = flap;
            animal.rightWing.rotation.z = -flap;
        } else if (animal.type === 'sheep') {
            // Movimiento tranquilo en círculo pequeño y cabeza bajando a comer pasto
            const t = elapsedTime * 0.4 + animal.phase;
            animal.group.position.x = animal.originX + Math.cos(t) * 1.8;
            animal.group.position.z = animal.originZ + Math.sin(t) * 1.8;
            animal.group.rotation.y = -t;
            animal.head.rotation.x = Math.max(0, Math.sin(elapsedTime * 2.2 + animal.phase)) * 0.45;
        }
    });
}

// --- FÍSICAS, MOVIMIENTO SUAVE Y COLISIONES ---
function updatePhysicsAndMovement(delta) {
    if (!player) return;

    const turnSpeed = 2.4;
    if (keys.a) targetRotationY += turnSpeed * delta;
    if (keys.d) targetRotationY -= turnSpeed * delta;

    player.rotation.y = THREE.MathUtils.lerp(player.rotation.y, targetRotationY, 10 * delta);

    let targetSpeed = 0;
    if (!isAttacking) {
        if (keys.w) targetSpeed = keys.shift ? 7.0 : 3.2;
        else if (keys.s) targetSpeed = -2.2;
    }
    currentSpeed = THREE.MathUtils.lerp(currentSpeed, targetSpeed, 8 * delta);

    if (Math.abs(currentSpeed) > 0.01) {
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y);
        player.position.addScaledVector(forward, currentSpeed * delta);
    }

    player.position.x = THREE.MathUtils.clamp(player.position.x, -MAP_LIMIT, MAP_LIMIT);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -MAP_LIMIT, MAP_LIMIT);

    // Colisión contra rocas y árboles sólidos
    staticObstacles.forEach((obs) => {
        const dx = player.position.x - obs.mesh.position.x;
        const dz = player.position.z - obs.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        const minDist = PLAYER_RADIUS + obs.radius;

        if (dist < minDist && dist > 0.001) {
            const overlap = minDist - dist;
            player.position.x += (dx / dist) * overlap;
            player.position.z += (dz / dist) * overlap;
        }
    });

    // Colisión e impulso de barriles/troncos dinámicos
    dynamicObjects.forEach((bar) => {
        const dx = bar.mesh.position.x - player.position.x;
        const dz = bar.mesh.position.z - player.position.z;
        const dist = Math.hypot(dx, dz);
        const minDist = PLAYER_RADIUS + bar.radius;

        if (dist < minDist && dist > 0.001) {
            const nx = dx / dist;
            const nz = dz / dist;
            const overlap = minDist - dist;

            bar.mesh.position.x += nx * overlap;
            bar.mesh.position.z += nz * overlap;
            bar.velocity.x += nx * 6.0;
            bar.velocity.z += nz * 6.0;
        }

        bar.mesh.position.addScaledVector(bar.velocity, delta);
        bar.velocity.multiplyScalar(0.92);

        if (Math.abs(bar.mesh.position.x) > MAP_LIMIT) {
            bar.mesh.position.x = Math.sign(bar.mesh.position.x) * MAP_LIMIT;
            bar.velocity.x *= -0.5;
        }
        if (Math.abs(bar.mesh.position.z) > MAP_LIMIT) {
            bar.mesh.position.z = Math.sign(bar.mesh.position.z) * MAP_LIMIT;
            bar.velocity.z *= -0.5;
        }
    });

    // Simulación física de fragmentos al romper objetos
    for (let i = debrisPieces.length - 1; i >= 0; i--) {
        const p = debrisPieces[i];
        p.velocity.y -= 15 * delta;
        p.mesh.position.addScaledVector(p.velocity, delta);
        p.mesh.rotation.x += p.rotSpeed.x * delta;
        p.mesh.rotation.y += p.rotSpeed.y * delta;

        if (p.mesh.position.y < 0.15) {
            p.mesh.position.y = 0.15;
            p.velocity.y *= -0.4;
            p.velocity.x *= 0.7;
            p.velocity.z *= 0.7;
        }

        p.life -= delta;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            debrisPieces.splice(i, 1);
        }
    }

    // Seguimiento suave de cámara con distancia gradual controlada por rueda
    const desiredTarget = new THREE.Vector3(player.position.x, 1.4, player.position.z);
    const targetDelta = desiredTarget.clone().sub(controls.target).multiplyScalar(Math.min(7 * delta, 1));
    controls.target.add(targetDelta);
    camera.position.add(targetDelta);

    currentZoomDistance = THREE.MathUtils.lerp(currentZoomDistance, targetZoomDistance, 8 * delta);
    const offset = camera.position.clone().sub(controls.target);
    if (offset.length() > 0.001) {
        offset.setLength(currentZoomDistance);
        camera.position.copy(controls.target).add(offset);
    }
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsedTime = clock.elapsedTime;

    if (mixer) mixer.update(delta);
    updateEnvironmentAnimations(elapsedTime, delta);
    updatePhysicsAndMovement(delta);

    controls.update();
    renderer.render(scene, camera);
}