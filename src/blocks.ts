import * as Blockly from "blockly";
import { javascriptGenerator, Order } from "blockly/javascript";

const SHAPE_COLOR = 120;
const TRANSFORM_COLOR = 210;
const BOOLEAN_COLOR = 280;
const OUTPUT_COLOR = 20;

// ---- ブロック定義 ----------------------------------------------------------

Blockly.defineBlocksWithJsonArray([
  {
    type: "cad_box",
    message0: "直方体 幅 %1 奥行 %2 高さ %3",
    args0: [
      { type: "input_value", name: "W", check: "Number" },
      { type: "input_value", name: "D", check: "Number" },
      { type: "input_value", name: "H", check: "Number" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: SHAPE_COLOR,
    tooltip: "底面の中心が原点にある直方体",
  },
  {
    type: "cad_cylinder",
    message0: "円柱 半径 %1 高さ %2",
    args0: [
      { type: "input_value", name: "R", check: "Number" },
      { type: "input_value", name: "H", check: "Number" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: SHAPE_COLOR,
    tooltip: "Z軸方向に伸びる円柱",
  },
  {
    type: "cad_sphere",
    message0: "球 半径 %1",
    args0: [{ type: "input_value", name: "R", check: "Number" }],
    inputsInline: true,
    output: "Shape",
    colour: SHAPE_COLOR,
    tooltip: "原点を中心とする球",
  },
  {
    type: "cad_translate",
    message0: "移動 x %1 y %2 z %3 %4",
    args0: [
      { type: "input_value", name: "X", check: "Number" },
      { type: "input_value", name: "Y", check: "Number" },
      { type: "input_value", name: "Z", check: "Number" },
      { type: "input_value", name: "SHAPE", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: TRANSFORM_COLOR,
  },
  {
    type: "cad_rotate",
    message0: "回転 軸 %1 角度 %2 %3",
    args0: [
      {
        type: "field_dropdown",
        name: "AXIS",
        options: [
          ["X", "[1, 0, 0]"],
          ["Y", "[0, 1, 0]"],
          ["Z", "[0, 0, 1]"],
        ],
      },
      { type: "input_value", name: "ANGLE", check: "Number" },
      { type: "input_value", name: "SHAPE", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: TRANSFORM_COLOR,
  },
  {
    type: "cad_scale",
    message0: "拡大縮小 倍率 %1 %2",
    args0: [
      { type: "input_value", name: "FACTOR", check: "Number" },
      { type: "input_value", name: "SHAPE", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: TRANSFORM_COLOR,
  },
  {
    type: "cad_union",
    message0: "合体 %1 と %2",
    args0: [
      { type: "input_value", name: "A", check: "Shape" },
      { type: "input_value", name: "B", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: BOOLEAN_COLOR,
  },
  {
    type: "cad_difference",
    message0: "けずる 元 %1 けずる形 %2",
    args0: [
      { type: "input_value", name: "A", check: "Shape" },
      { type: "input_value", name: "B", check: "Shape" },
    ],
    inputsInline: false,
    tooltip: "「元」の形状から「けずる形」を取り除く",
    output: "Shape",
    colour: BOOLEAN_COLOR,
  },
  {
    type: "cad_intersect",
    message0: "共通部分 %1 と %2",
    args0: [
      { type: "input_value", name: "A", check: "Shape" },
      { type: "input_value", name: "B", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: BOOLEAN_COLOR,
  },
  {
    type: "cad_fillet",
    message0: "フィレット 半径 %1 %2",
    args0: [
      { type: "input_value", name: "R", check: "Number" },
      { type: "input_value", name: "SHAPE", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: BOOLEAN_COLOR,
    tooltip: "すべてのエッジを丸める",
  },
  {
    type: "cad_chamfer",
    message0: "面取り 幅 %1 %2",
    args0: [
      { type: "input_value", name: "R", check: "Number" },
      { type: "input_value", name: "SHAPE", check: "Shape" },
    ],
    inputsInline: false,
    output: "Shape",
    colour: BOOLEAN_COLOR,
    tooltip: "すべてのエッジを面取りする",
  },
  {
    type: "cad_show",
    message0: "表示する %1",
    args0: [{ type: "input_value", name: "SHAPE", check: "Shape" }],
    previousStatement: null,
    nextStatement: null,
    colour: OUTPUT_COLOR,
    tooltip: "この形状を3Dビューに表示する",
  },
]);

// ---- コード生成 ------------------------------------------------------------

const g = javascriptGenerator;

function num(block: Blockly.Block, name: string, fallback = "0"): string {
  return g.valueToCode(block, name, Order.NONE) || fallback;
}

function shape(block: Blockly.Block, name: string): string | null {
  const code = g.valueToCode(block, name, Order.MEMBER);
  return code || null;
}

g.forBlock["cad_box"] = (block) => [
  `replicad.makeBaseBox(${num(block, "W", "1")}, ${num(block, "D", "1")}, ${num(block, "H", "1")})`,
  Order.FUNCTION_CALL,
];

g.forBlock["cad_cylinder"] = (block) => [
  `replicad.makeCylinder(${num(block, "R", "1")}, ${num(block, "H", "1")})`,
  Order.FUNCTION_CALL,
];

g.forBlock["cad_sphere"] = (block) => [
  `replicad.makeSphere(${num(block, "R", "1")})`,
  Order.FUNCTION_CALL,
];

g.forBlock["cad_translate"] = (block) => {
  const s = shape(block, "SHAPE");
  if (!s) return ["null", Order.ATOMIC];
  return [
    `${s}.translate([${num(block, "X")}, ${num(block, "Y")}, ${num(block, "Z")}])`,
    Order.FUNCTION_CALL,
  ];
};

g.forBlock["cad_rotate"] = (block) => {
  const s = shape(block, "SHAPE");
  if (!s) return ["null", Order.ATOMIC];
  const axis = block.getFieldValue("AXIS");
  return [
    `${s}.rotate(${num(block, "ANGLE")}, [0, 0, 0], ${axis})`,
    Order.FUNCTION_CALL,
  ];
};

g.forBlock["cad_scale"] = (block) => {
  const s = shape(block, "SHAPE");
  if (!s) return ["null", Order.ATOMIC];
  return [`${s}.scale(${num(block, "FACTOR", "1")})`, Order.FUNCTION_CALL];
};

function binaryOp(method: string) {
  return (block: Blockly.Block): [string, number] => {
    const a = shape(block, "A");
    const b = shape(block, "B");
    if (!a || !b) return [a ?? b ?? "null", Order.ATOMIC];
    return [`${a}.${method}(${b})`, Order.FUNCTION_CALL];
  };
}

g.forBlock["cad_union"] = binaryOp("fuse");
g.forBlock["cad_difference"] = binaryOp("cut");
g.forBlock["cad_intersect"] = binaryOp("intersect");

g.forBlock["cad_fillet"] = (block) => {
  const s = shape(block, "SHAPE");
  if (!s) return ["null", Order.ATOMIC];
  return [`${s}.fillet(${num(block, "R", "1")})`, Order.FUNCTION_CALL];
};

g.forBlock["cad_chamfer"] = (block) => {
  const s = shape(block, "SHAPE");
  if (!s) return ["null", Order.ATOMIC];
  return [`${s}.chamfer(${num(block, "R", "1")})`, Order.FUNCTION_CALL];
};

g.forBlock["cad_show"] = (block) => {
  const s = shape(block, "SHAPE");
  if (!s) return "";
  // 3Dビューでのクリック選択用に、形状を作ったブロックのIDも記録する
  // (コード表示パネルでは shapeIds の行は取り除かれる)
  const id = block.getInputTargetBlock("SHAPE")?.id ?? "";
  return (
    `shapes.push(${s});\n` +
    `shapeIds[shapes.length - 1] = ${JSON.stringify(id)};\n`
  );
};

// ---- ツールボックス --------------------------------------------------------

export const toolbox = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "形状",
      colour: `${SHAPE_COLOR}`,
      contents: [
        shadowedBlock("cad_box", { W: 30, D: 20, H: 10 }),
        shadowedBlock("cad_cylinder", { R: 5, H: 20 }),
        shadowedBlock("cad_sphere", { R: 10 }),
      ],
    },
    {
      kind: "category",
      name: "変形",
      colour: `${TRANSFORM_COLOR}`,
      contents: [
        shadowedBlock("cad_translate", { X: 0, Y: 0, Z: 0 }),
        shadowedBlock("cad_rotate", { ANGLE: 0 }),
        shadowedBlock("cad_scale", { FACTOR: 2 }),
      ],
    },
    {
      kind: "category",
      name: "組み合わせ",
      colour: `${BOOLEAN_COLOR}`,
      contents: [
        { kind: "block", type: "cad_union" },
        { kind: "block", type: "cad_difference" },
        { kind: "block", type: "cad_intersect" },
        shadowedBlock("cad_fillet", { R: 2 }),
        shadowedBlock("cad_chamfer", { R: 1 }),
      ],
    },
    {
      kind: "category",
      name: "出力",
      colour: `${OUTPUT_COLOR}`,
      contents: [{ kind: "block", type: "cad_show" }],
    },
    { kind: "sep" },
    {
      kind: "category",
      name: "数値",
      colour: "230",
      contents: [
        { kind: "block", type: "math_number" },
        { kind: "block", type: "math_arithmetic" },
      ],
    },
    {
      kind: "category",
      name: "くり返し",
      colour: "120",
      contents: [
        {
          kind: "block",
          type: "controls_repeat_ext",
          inputs: {
            TIMES: { shadow: { type: "math_number", fields: { NUM: 5 } } },
          },
        },
        { kind: "block", type: "controls_for" },
      ],
    },
    {
      kind: "category",
      name: "変数",
      custom: "VARIABLE",
      colour: "330",
    },
    {
      kind: "category",
      name: "関数",
      custom: "PROCEDURE",
      colour: "290",
    },
  ],
};

// 数値入力にシャドウブロックを差し込むためのヘルパー
function shadowedBlock(type: string, defaults: Record<string, number>) {
  const inputs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(defaults)) {
    inputs[name] = { shadow: { type: "math_number", fields: { NUM: value } } };
  }
  return { kind: "block", type, inputs };
}
