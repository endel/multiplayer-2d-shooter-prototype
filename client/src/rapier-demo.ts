import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';

// Seeded random number generator
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const random = seededRandom(42);

// Input state
const keys: Record<string, boolean> = {};
let mouseMovementX = 0;
let mouseMovementY = 0;
let isPointerLocked = false;

// Physics objects tracking
interface PhysicsBox {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
}

async function main() {
  document.getElementById('loading')?.classList.add('hidden');

  // Create physics world with gravity
  const gravity = { x: 0, y: -20, z: 0 };
  const world = new RAPIER.World(gravity);

  // Three.js setup
  const container = document.getElementById('canvas-container')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);
  scene.fog = new THREE.Fog(0x0a0a1a, 20, 80);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 10);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffeedd, 1.5);
  directionalLight.position.set(15, 25, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 100;
  directionalLight.shadow.camera.left = -30;
  directionalLight.shadow.camera.right = 30;
  directionalLight.shadow.camera.top = 30;
  directionalLight.shadow.camera.bottom = -30;
  scene.add(directionalLight);

  // Add some colored point lights for atmosphere
  const pointLight1 = new THREE.PointLight(0x64ffda, 2, 20);
  pointLight1.position.set(-10, 5, -10);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0xff6b6b, 2, 20);
  pointLight2.position.set(10, 5, 10);
  scene.add(pointLight2);

  // Ground plane
  const groundGeometry = new THREE.PlaneGeometry(100, 100);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x1a1a2e,
    roughness: 0.8,
    metalness: 0.2
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Ground grid for visual reference
  const gridHelper = new THREE.GridHelper(100, 50, 0x64ffda, 0x16213e);
  gridHelper.position.y = 0.01;
  (gridHelper.material as THREE.Material).opacity = 0.3;
  (gridHelper.material as THREE.Material).transparent = true;
  scene.add(gridHelper);

  // Ground physics body
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(50, 0.1, 50);
  world.createCollider(groundColliderDesc);

  // Character controller setup
  const characterHeight = 1.8;
  const characterRadius = 0.4;
  
  // Character visual (capsule-like shape using cylinder + spheres)
  const characterGroup = new THREE.Group();
  
  const bodyGeometry = new THREE.CylinderGeometry(characterRadius, characterRadius, characterHeight - characterRadius * 2, 16);
  const bodyMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x64ffda,
    roughness: 0.3,
    metalness: 0.7,
    emissive: 0x64ffda,
    emissiveIntensity: 0.1
  });
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bodyMesh.castShadow = true;
  characterGroup.add(bodyMesh);
  
  // Top sphere
  const topSphere = new THREE.Mesh(
    new THREE.SphereGeometry(characterRadius, 16, 16),
    bodyMaterial
  );
  topSphere.position.y = (characterHeight - characterRadius * 2) / 2;
  topSphere.castShadow = true;
  characterGroup.add(topSphere);
  
  // Bottom sphere
  const bottomSphere = new THREE.Mesh(
    new THREE.SphereGeometry(characterRadius, 16, 16),
    bodyMaterial
  );
  bottomSphere.position.y = -(characterHeight - characterRadius * 2) / 2;
  bottomSphere.castShadow = true;
  characterGroup.add(bottomSphere);
  
  characterGroup.position.set(0, characterHeight / 2 + 0.1, 0);
  scene.add(characterGroup);

  // Character physics body (kinematic for character controller)
  const characterBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, characterHeight / 2 + 0.1, 0);
  const characterBody = world.createRigidBody(characterBodyDesc);
  
  const characterColliderDesc = RAPIER.ColliderDesc.capsule(
    (characterHeight - characterRadius * 2) / 2,
    characterRadius
  );
  world.createCollider(characterColliderDesc, characterBody);

  // Create Rapier character controller
  const characterController = world.createCharacterController(0.01);
  characterController.enableAutostep(0.5, 0.2, true);
  characterController.enableSnapToGround(0.5);
  characterController.setSlideEnabled(true);
  characterController.setApplyImpulsesToDynamicBodies(true);

  // Character state
  let characterYaw = 0;
  let cameraPitch = 0;
  let verticalVelocity = 0;
  const moveSpeed = 8;
  const jumpForce = 10;

  // Create boxes with seeded random positions and rotations
  const boxes: PhysicsBox[] = [];
  const boxColors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da];
  
  for (let i = 0; i < 15; i++) {
    const size = 0.8 + random() * 1.2;
    const x = (random() - 0.5) * 30;
    const z = (random() - 0.5) * 30;
    const y = size / 2 + random() * 3;
    
    // Visual
    const boxGeometry = new THREE.BoxGeometry(size, size, size);
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: boxColors[Math.floor(random() * boxColors.length)],
      roughness: 0.4,
      metalness: 0.3
    });
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    
    // Random rotation
    const rotX = random() * Math.PI * 2;
    const rotY = random() * Math.PI * 2;
    const rotZ = random() * Math.PI * 2;
    boxMesh.rotation.set(rotX, rotY, rotZ);
    boxMesh.position.set(x, y, z);
    scene.add(boxMesh);
    
    // Physics body (dynamic)
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
    const boxBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const boxBody = world.createRigidBody(boxBodyDesc);
    
    const boxColliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      .setDensity(1.0)
      .setFriction(0.7)
      .setRestitution(0.2);
    world.createCollider(boxColliderDesc, boxBody);
    
    boxes.push({ mesh: boxMesh, body: boxBody });
  }

  // Input handling
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (isPointerLocked) {
      mouseMovementX += e.movementX;
      mouseMovementY += e.movementY;
    }
  });

  // Pointer lock for mouse look
  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
  });

  // Window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Game loop
  let lastTime = performance.now();
  
  function gameLoop() {
    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    // Mouse look
    const mouseSensitivity = 0.002;
    characterYaw -= mouseMovementX * mouseSensitivity;
    cameraPitch -= mouseMovementY * mouseSensitivity;
    cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraPitch));
    mouseMovementX = 0;
    mouseMovementY = 0;

    // Calculate movement direction based on character yaw
    const forward = new THREE.Vector3(
      -Math.sin(characterYaw),
      0,
      -Math.cos(characterYaw)
    );
    const right = new THREE.Vector3(
      Math.cos(characterYaw),
      0,
      -Math.sin(characterYaw)
    );

    // Input to movement
    const moveDir = new THREE.Vector3(0, 0, 0);
    if (keys['KeyW']) moveDir.add(forward);
    if (keys['KeyS']) moveDir.sub(forward);
    if (keys['KeyD']) moveDir.add(right);
    if (keys['KeyA']) moveDir.sub(right);
    
    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    // Apply gravity and jumping
    const isGrounded = characterController.computedGrounded();
    
    if (isGrounded) {
      verticalVelocity = 0;
      if (keys['Space']) {
        verticalVelocity = jumpForce;
      }
    } else {
      verticalVelocity -= 30 * deltaTime; // Gravity
    }

    // Calculate desired movement
    const movement = {
      x: moveDir.x * moveSpeed * deltaTime,
      y: verticalVelocity * deltaTime,
      z: moveDir.z * moveSpeed * deltaTime
    };

    // Get character collider
    const characterCollider = characterBody.collider(0);
    
    // Compute movement with character controller
    characterController.computeColliderMovement(
      characterCollider,
      movement,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
      null
    );

    // Get corrected movement
    const correctedMovement = characterController.computedMovement();
    
    // Apply movement to character body
    const currentPos = characterBody.translation();
    const newPos = {
      x: currentPos.x + correctedMovement.x,
      y: currentPos.y + correctedMovement.y,
      z: currentPos.z + correctedMovement.z
    };
    characterBody.setNextKinematicTranslation(newPos);

    // Update visual character position
    characterGroup.position.set(newPos.x, newPos.y, newPos.z);

    // Update camera position (third-person follow)
    const cameraOffset = new THREE.Vector3(0, 2, 5);
    cameraOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), cameraPitch);
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), characterYaw);
    
    camera.position.copy(characterGroup.position).add(cameraOffset);
    camera.lookAt(
      characterGroup.position.x,
      characterGroup.position.y + 1,
      characterGroup.position.z
    );

    // Step physics world
    world.step();

    // Sync box meshes with physics bodies
    for (const box of boxes) {
      const pos = box.body.translation();
      const rot = box.body.rotation();
      box.mesh.position.set(pos.x, pos.y, pos.z);
      box.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    // Render
    renderer.render(scene, camera);
    requestAnimationFrame(gameLoop);
  }

  gameLoop();
}

main().catch(console.error);

