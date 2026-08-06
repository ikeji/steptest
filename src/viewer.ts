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

  // ---- 回転ダイヤル (全周リング+目盛り+針。ドラッグでノブのように回す) ----
  private rotateDial = new THREE.Group();
  private dialHandle = new THREE.Group();
  private dialHitDisc!: THREE.Mesh;
  private dialAxis: "x" | "y" | "z" = "z";
  private dialDragging = false;
  private dialLabel!: HTMLDivElement;
  private dialRingMaterial = new THREE.MeshBasicMaterial({ color: 0x4466dd });
  private dialNeedleMaterial = new THREE.LineBasicMaterial({ color: 0x4466dd });

  // 各軸のダイヤル平面: u=0°方向, v=90°方向, n=回転軸 (右手系)
  private static readonly DIAL_BASES = {
    x: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], color: 0xe06666 },
    y: { u: [0, 0, 1], v: [1, 0, 0], n: [0, 1, 0], color: 0x66bb6a },
    z: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], color: 0x64b5f6 },
  } as const;

  /** 移動ギズモをドラッグして位置が変わったときに呼ばれる */
  onGizmoMove?: (pos: { x: number; y: number; z: number }) => void;
  /** 回転ギズモをドラッグして角度が変わったときに呼ばれる (度) */
  onGizmoRotate?: (angleDeg: number) => void;
  /** 形状をクリックしたとき (blockId)、空きをクリックしたとき (null) に呼ばれる */
  onPickShape?: (blockId: string | null, mods: { shiftKey: boolean }) => void;
  private raycaster = new THREE.Raycaster();
  private highlightIds: string[] = [];
  // 複数選択のハイライト: 1つ目 (元) は明るい青、2つ目 (相手) はオレンジ
  private highlightMaterials = [
    new THREE.MeshStandardMaterial({
      color: 0x64b5f6,
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
    new THREE.MeshStandardMaterial({
      color: 0xffb74d,
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
  ];
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
      const { x, y, z } = this.gizmoTarget.position;
      this.onGizmoMove?.({ x, y, z });
    });
    this.scene.add(this.gizmo.getHelper());

    this.buildRotateDial();
    this.scene.add(this.rotateDial);
    this.dialLabel = document.createElement("div");
    this.dialLabel.style.cssText =
      "position:absolute;top:12px;left:12px;padding:4px 10px;background:#263238cc;" +
      "color:#eceff1;font-size:13px;border-radius:6px;pointer-events:none;display:none;";
    container.appendChild(this.dialLabel);

    // クリック (ドラッグやギズモ操作でない) で形状を選択できるようにする
    const dom = this.renderer.domElement;
    let downAt: { x: number; y: number } | null = null;
    dom.addEventListener("pointerdown", (event) => {
      // 回転ダイヤル上ならドラッグ開始
      if (this.rotateDial.visible && this.isPointerOnDial(event)) {
        this.dialDragging = true;
        this.controls.enabled = false;
        this.applyDialPointer(event);
        downAt = null;
        return;
      }
      // ギズモのハンドル上 (ホバーで axis が立つ) なら選択処理はしない
      downAt = this.gizmo.axis ? null : { x: event.clientX, y: event.clientY };
    });
    dom.addEventListener("pointermove", (event) => {
      if (this.dialDragging) this.applyDialPointer(event);
    });
    dom.addEventListener("pointerup", () => {
      if (this.dialDragging) {
        this.dialDragging = false;
        this.controls.enabled = true;
      }
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
        { shiftKey: event.shiftKey },
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
    return this.gizmo.dragging || this.dialDragging;
  }

  get gizmoVisible(): boolean {
    return this.gizmo.object != null || this.rotateDial.visible;
  }

  showTranslateGizmo(pos: { x: number; y: number; z: number }) {
    this.rotateDial.visible = false;
    this.dialLabel.style.display = "none";
    if (!this.gizmo.dragging) {
      this.gizmoTarget.position.set(pos.x, pos.y, pos.z);
    }
    if (!this.gizmo.object) this.gizmo.attach(this.gizmoTarget);
  }

  // 単位サイズで作っておき、表示時に形状に合わせてスケールする
  private buildRotateDial() {
    this.rotateDial.visible = false;
    // 全周リング
    this.rotateDial.add(
      new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 96), this.dialRingMaterial),
    );
    // 30°ごとの目盛り (0°は長め)
    const tickPoints: THREE.Vector3[] = [];
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = THREE.MathUtils.degToRad(deg);
      const inner = deg === 0 ? 0.8 : 0.92;
      tickPoints.push(
        new THREE.Vector3(Math.cos(rad) * inner, Math.sin(rad) * inner, 0),
        new THREE.Vector3(Math.cos(rad), Math.sin(rad), 0),
      );
    }
    this.rotateDial.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(tickPoints),
        new THREE.LineBasicMaterial({ color: 0x90a4ae }),
      ),
    );
    // 現在角度の針とつまみ
    this.dialHandle.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(1, 0, 0),
        ]),
        this.dialNeedleMaterial,
      ),
    );
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), this.dialRingMaterial);
    knob.position.set(1, 0, 0);
    this.dialHandle.add(knob);
    this.rotateDial.add(this.dialHandle);
    // 当たり判定用の見えない円盤
    this.dialHitDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 48),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.rotateDial.add(this.dialHitDisc);
  }

  private setDialAngle(angleDeg: number) {
    this.dialHandle.rotation.z = THREE.MathUtils.degToRad(angleDeg);
    this.dialLabel.textContent = `回転 ${this.dialAxis.toUpperCase()}: ${Math.round(angleDeg)}°`;
  }

  private rayFromPointer(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private isPointerOnDial(event: PointerEvent): boolean {
    this.rayFromPointer(event);
    return this.raycaster.intersectObject(this.dialHitDisc, false).length > 0;
  }

  // ポインタ位置をダイヤル平面に投影して角度にする (ノブのように追従)
  private applyDialPointer(event: PointerEvent) {
    this.rayFromPointer(event);
    const basis = Viewer.DIAL_BASES[this.dialAxis];
    const normal = new THREE.Vector3(...basis.n);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(normal, 0), point)) {
      return;
    }
    const angle = THREE.MathUtils.radToDeg(
      Math.atan2(
        point.dot(new THREE.Vector3(...basis.v)),
        point.dot(new THREE.Vector3(...basis.u)),
      ),
    );
    this.setDialAngle(angle);
    this.onGizmoRotate?.(angle);
  }

  // 回転ブロックは原点まわりの回転なので、ダイヤルは常に原点に置く
  showRotateGizmo(axis: "x" | "y" | "z", angleDeg: number) {
    if (this.gizmo.object) this.gizmo.detach(); // 移動ギズモは消す
    this.dialAxis = axis;
    const basis = Viewer.DIAL_BASES[axis];
    this.rotateDial.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...basis.u),
        new THREE.Vector3(...basis.v),
        new THREE.Vector3(...basis.n),
      ),
    );
    this.dialRingMaterial.color.set(basis.color);
    this.dialNeedleMaterial.color.set(basis.color);
    if (!this.dialDragging) {
      // 形状より少し大きい半径にする
      const box = new THREE.Box3().setFromObject(this.shapeGroup);
      let radius = 20;
      if (!box.isEmpty()) {
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        radius = Math.min(Math.max(sphere.radius * 1.2 + 2, 8), 300);
      }
      this.rotateDial.scale.setScalar(radius);
    }
    this.setDialAngle(angleDeg);
    this.rotateDial.visible = true;
    this.dialLabel.style.display = "block";
  }

  hideGizmo() {
    if (this.gizmo.object) this.gizmo.detach();
    this.rotateDial.visible = false;
    this.dialLabel.style.display = "none";
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
    this.applyHighlights();
  }

  setHighlights(ids: string[]) {
    this.highlightIds = ids;
    this.applyHighlights();
  }

  private applyHighlights() {
    for (const child of this.shapeGroup.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const index = this.highlightIds.indexOf(child.userData.blockId);
      child.material =
        index >= 0
          ? this.highlightMaterials[Math.min(index, 1)]
          : this.faceMaterial;
    }
  }
}
