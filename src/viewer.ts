import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { syncGeometries } from "replicad-threejs-helper";

export class Viewer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private shapeGroup = new THREE.Group();
  private gizmo: TransformControls;
  private gizmoTarget = new THREE.Object3D();
  private gizmoMode: "translate" | "rotate" = "translate";
  private gizmoAxis: "x" | "y" | "z" = "z";

  /** 移動ギズモをドラッグして位置が変わったときに呼ばれる */
  onGizmoMove?: (pos: { x: number; y: number; z: number }) => void;
  /** 回転ギズモをドラッグして角度が変わったときに呼ばれる (度) */
  onGizmoRotate?: (angleDeg: number) => void;
  /** 形状をクリックしたとき (blockId)、空きをクリックしたとき (null) に呼ばれる */
  onPickShape?: (blockId: string | null) => void;
  private raycaster = new THREE.Raycaster();
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

    this.scene.add(this.gizmoTarget);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.addEventListener("dragging-changed", (event) => {
      // ギズモ操作中はカメラ回転を止める
      this.controls.enabled = !(event as { value?: boolean }).value;
    });
    this.gizmo.addEventListener("objectChange", () => {
      if (this.gizmoMode === "translate") {
        const { x, y, z } = this.gizmoTarget.position;
        this.onGizmoMove?.({ x, y, z });
      } else if (this.gizmo.axis?.toLowerCase() === this.gizmoAxis) {
        // 表示中の軸リング以外 (自由回転リング等) のドラッグは無視する
        this.onGizmoRotate?.(
          THREE.MathUtils.radToDeg(this.gizmoTarget.rotation[this.gizmoAxis]),
        );
      }
    });
    this.scene.add(this.gizmo.getHelper());

    // クリック (ドラッグやギズモ操作でない) で形状を選択できるようにする
    const dom = this.renderer.domElement;
    let downAt: { x: number; y: number } | null = null;
    dom.addEventListener("pointerdown", (event) => {
      // ギズモのハンドル上 (ホバーで axis が立つ) なら選択処理はしない
      downAt = this.gizmo.axis ? null : { x: event.clientX, y: event.clientY };
    });
    dom.addEventListener("pointerup", (event) => {
      if (!downAt) return;
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return; // カメラ操作のドラッグ
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const meshes = this.shapeGroup.children.filter(
        (c): c is THREE.Mesh => c instanceof THREE.Mesh,
      );
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      this.onPickShape?.(
        hit ? ((hit.object.userData.blockId as string | null) ?? null) : null,
      );
    });

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

  get gizmoDragging(): boolean {
    return this.gizmo.dragging;
  }

  get gizmoVisible(): boolean {
    return this.gizmo.object != null;
  }

  showTranslateGizmo(pos: { x: number; y: number; z: number }) {
    this.gizmoMode = "translate";
    this.gizmo.setMode("translate");
    this.gizmo.showX = this.gizmo.showY = this.gizmo.showZ = true;
    if (!this.gizmo.dragging) {
      this.gizmoTarget.position.set(pos.x, pos.y, pos.z);
      this.gizmoTarget.rotation.set(0, 0, 0);
    }
    if (!this.gizmo.object) this.gizmo.attach(this.gizmoTarget);
  }

  // 回転ブロックは原点まわりの回転なので、リングは常に原点に置く
  showRotateGizmo(axis: "x" | "y" | "z", angleDeg: number) {
    this.gizmoMode = "rotate";
    this.gizmoAxis = axis;
    this.gizmo.setMode("rotate");
    this.gizmo.showX = axis === "x";
    this.gizmo.showY = axis === "y";
    this.gizmo.showZ = axis === "z";
    if (!this.gizmo.dragging) {
      this.gizmoTarget.position.set(0, 0, 0);
      this.gizmoTarget.rotation.set(0, 0, 0);
      this.gizmoTarget.rotation[axis] = THREE.MathUtils.degToRad(angleDeg);
    }
    if (!this.gizmo.object) this.gizmo.attach(this.gizmoTarget);
  }

  hideGizmo() {
    if (this.gizmo.object) this.gizmo.detach();
  }

  updateShapes(meshes: unknown[]) {
    const blockIds = (meshes as { blockId?: string | null }[]).map(
      (m) => m.blockId ?? null,
    );
    this.geometries = syncGeometries(meshes as never, this.geometries as never);

    this.shapeGroup.clear();
    this.geometries.forEach(({ faces, lines }, i) => {
      const mesh = new THREE.Mesh(faces, this.faceMaterial);
      mesh.userData.blockId = blockIds[i];
      this.shapeGroup.add(mesh);
      this.shapeGroup.add(new THREE.LineSegments(lines, this.lineMaterial));
    });
  }
}
