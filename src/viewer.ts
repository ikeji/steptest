import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { syncGeometries } from "replicad-threejs-helper";

export class Viewer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private shapeGroup = new THREE.Group();
  private geometries: { faces: THREE.BufferGeometry; lines: THREE.BufferGeometry }[] = [];

  private faceMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a8296,
    metalness: 0.1,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  private lineMaterial = new THREE.LineBasicMaterial({ color: 0x2b3d47 });

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0x1a1d21);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.position.set(60, -60, 50);
    this.camera.up.set(0, 0, 1); // CADなのでZ-up

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(50, -80, 100);
    this.scene.add(light);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-50, 80, -40);
    this.scene.add(backLight);

    const grid = new THREE.GridHelper(200, 20, 0x37474f, 0x263238);
    grid.rotation.x = Math.PI / 2; // XY平面に敷く
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(20));
    this.scene.add(this.shapeGroup);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      this.camera.aspect = clientWidth / Math.max(clientHeight, 1);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(clientWidth, clientHeight);
    };
    new ResizeObserver(resize).observe(container);
    resize();

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  updateShapes(meshes: unknown[]) {
    this.geometries = syncGeometries(meshes as never, this.geometries as never);

    this.shapeGroup.clear();
    for (const { faces, lines } of this.geometries) {
      this.shapeGroup.add(new THREE.Mesh(faces, this.faceMaterial));
      this.shapeGroup.add(new THREE.LineSegments(lines, this.lineMaterial));
    }
  }
}
