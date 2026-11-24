// Grim Bunker: a tiny raycast shooter drawn on the phone's 96 x 65 LCD pixels.
// Written in ES5 so it runs on older phones.

var ui = window.bridge.ui;
var lcd = window.bridge.lcd;

var W = 96;
var H = 65;
var VIEW_H = 56; // rows of the 3D view, the HUD sits below
var HORIZON = VIEW_H / 2;
var PLANE = 0.75; // camera plane length, sets the field of view
var FOCAL = W / 2 / PLANE;
var TEX = 16;

var MOVE_SPEED = 2.6;
var TURN_SPEED = 2.5;
var PLAYER_R = 0.22;
var FIRE_COOLDOWN = 0.32;
var MAX_HP = 100;
var MAX_AMMO = 99;
var START_AMMO = 24;

var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------------------------------------------------------------- levels
// # brick  % stone  + panel  . floor  P player  g grunt  o orb  h medkit  a ammo  X exit
var LEVELS = [
  {
    angle: Math.PI / 2,
    map: [
      "####################",
      "#P....#......#.....#",
      "#.....#..g...#..a..#",
      "#..h..#......#.....#",
      "#.....##.#####.....#",
      "#........g.........#",
      "###.####....####.###",
      "#......#....#......#",
      "#..g...#....#...g..#",
      "#......+....+......#",
      "#..a...+.o..+......#",
      "###..###....###..###",
      "#..................#",
      "#..o...%%..%%...h..#",
      "#......%....%......#",
      "#..g...%.X..%...g..#",
      "#......%%..%%......#",
      "#..................#",
      "####################",
    ],
  },
  {
    angle: 0,
    map: [
      "########################",
      "#P...#.........#.......#",
      "#....#..o......#...g...#",
      "#....+.........+.......#",
      "#....#####..####...a...#",
      "#..h.....#..#..........#",
      "######...#..#..######..#",
      "#........#..#..#....#..#",
      "#..g.....g..g..#.o..#..#",
      "#........#..#..#....#..#",
      "#####.####..#..##..##..#",
      "#....................h.#",
      "#..a..%%%%%..%%%%%.....#",
      "#.....%...%..%...%..g..#",
      "#..o..%.o.%..%.X.%.....#",
      "#.....%...%..%...%.....#",
      "#.....%%.%%..%%.%%..a..#",
      "#..g...................#",
      "########################",
    ],
  },
  {
    angle: 0,
    map: [
      "######################",
      "#P.......#..........##",
      "#........#...g.......#",
      "#..a.....+.......o...#",
      "#........#...........#",
      "####..####....+++....#",
      "#.........g...+h+..g.#",
      "#..o..........+.+....#",
      "#.....%%%..........a.#",
      "#..g..%h%....o.......#",
      "#.....%.%..g.....%%..#",
      "#.................%..#",
      "###.#######.#######..#",
      "#..g.....o....g....g.#",
      "#....a.........h.....#",
      "#.........X..........#",
      "######################",
    ],
  },
];

// ---------------------------------------------------------------- wall textures
// Each texel says what line passes through it: H (a row line), V (a column line) or D (a dot).
// Lines are drawn only on the first screen pixel of a texel, so they stay 1 pixel thin up close.
var T_H = 1;
var T_V = 2;
var T_D = 3;

function makeTexture(fn) {
  var t = new Uint8Array(TEX * TEX);
  for (var y = 0; y < TEX; y++) {
    for (var x = 0; x < TEX; x++) t[y * TEX + x] = fn(x, y) || 0;
  }
  return t;
}

function hash(x, y) {
  var n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return (n ^ (n >> 16)) & 255;
}

var TEXTURES = {
  blank: new Uint8Array(TEX * TEX),
  "#": makeTexture(function (x, y) {
    var row = Math.floor(y / 4);
    if (y % 4 === 0) return T_H;
    if ((x + (row % 2) * 4) % 8 === 0) return T_V;
  }),
  "%": makeTexture(function (x, y) {
    var row = Math.floor(y / 8);
    if (y % 8 === 0) return T_H;
    if ((x + (row % 2) * 4) % 8 === 0) return T_V;
    if (hash(x, y) < 14) return T_D;
  }),
  "+": makeTexture(function (x, y) {
    if (y === 0 || y === 15) return T_H;
    if (x === 0 || x === 15) return T_V;
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return T_D;
    if (y >= 5 && y <= 10 && x >= 4 && x <= 11 && y % 2 === 1) return T_H;
  }),
};

// ---------------------------------------------------------------- sprites
// "#" dark, "o" light, "." see-through. Every sprite gets a light outline so it reads on any wall.
function sprite(rows) {
  var aw = 0;
  rows.forEach(function (r) {
    aw = Math.max(aw, r.length);
  });
  var w = aw + 2;
  var h = rows.length + 2;
  var d = new Uint8Array(w * h);
  var x, y;
  for (y = 0; y < rows.length; y++) {
    for (x = 0; x < aw; x++) {
      var c = rows[y].charAt(x);
      d[(y + 1) * w + x + 1] = c === "#" ? 1 : c === "o" ? 2 : 0;
    }
  }
  var out = new Uint8Array(d);
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      if (d[y * w + x]) continue;
      var near =
        (x > 0 && d[y * w + x - 1] === 1) ||
        (x < w - 1 && d[y * w + x + 1] === 1) ||
        (y > 0 && d[(y - 1) * w + x] === 1) ||
        (y < h - 1 && d[(y + 1) * w + x] === 1);
      if (near) out[y * w + x] = 2;
    }
  }
  return { w: w, h: h, d: out };
}

var GRUNT_TOP = [
  "..#........#..",
  "..##......##..",
  "...########...",
  "..##########..",
  "..#oo####oo#..",
  "..##########..",
  "...#o#oo#o#...",
  "....######....",
];
var GRUNT_BODY = [
  ".############.",
  "##.########.##",
  "#..########..#",
  "#..########..#",
];

var ART = {
  gruntA: sprite(GRUNT_TOP.concat(GRUNT_BODY, [
    "...###..###...",
    "...##....##...",
    "..###....###..",
    "..##......##..",
  ])),
  gruntB: sprite(GRUNT_TOP.concat(GRUNT_BODY, [
    "...###..###...",
    "....##..##....",
    "....##..##....",
    "...###..###...",
  ])),
  gruntAtk: sprite([
    "#.#........#.#",
    "#.##......##.#",
    "##.########.##",
    ".############.",
    "..#oo####oo#..",
    "..##########..",
    "...#oooooo#...",
    "....######....",
    "...########...",
    "...########...",
    "...########...",
    "...########...",
    "...###..###...",
    "...##....##...",
    "..###....###..",
    "..##......##..",
  ]),
  gruntDead: sprite([
    "..............", "..............", "..............", "..............",
    "..............", "..............", "..............", "..............",
    "..............", "..............", "..............", "..............",
    "..............",
    "..#.######.#..",
    ".###o####o###.",
    "##############",
  ]),
  orb: sprite([
    "......##......",
    "..#..####..#..",
    "...########...",
    "..##########..",
    ".####oooo####.",
    ".###oo##oo###.",
    "####o####o####",
    "####o####o####",
    ".###oo##oo###.",
    ".####oooo####.",
    "..##########..",
    "...########...",
    "..#..####..#..",
    "......##......",
  ]),
  orbAtk: sprite([
    "......##......",
    "..#..####..#..",
    "...########...",
    "..###oooo###..",
    ".###oooooo###.",
    ".##ooo##ooo##.",
    "###oo####oo###",
    "###oo####oo###",
    ".##ooo##ooo##.",
    ".###oooooo###.",
    "..###oooo###..",
    "...########...",
    "..#..####..#..",
    "......##......",
  ]),
  orbDead: sprite([
    "..............", "..............", "..............", "..............",
    "..............", "..............", "..............", "..............",
    "..............", "..............",
    "...#..##..#...",
    "..###.##.###..",
    ".##########...",
    "##############",
  ]),
  medkit: sprite([
    "...####...",
    "..#....#..",
    "##########",
    "####oo####",
    "##oooooo##",
    "##oooooo##",
    "####oo####",
    "##########",
  ]),
  ammo: sprite([
    ".#...#...#.",
    "###.###.###",
    "###.###.###",
    "###########",
    "#ooooooooo#",
    "#o#o#o#o#o#",
    "#ooooooooo#",
    "###########",
  ]),
  shot: sprite([".###.", "##o##", "#ooo#", "##o##", ".###."]),
};

var EXIT_ROWS = [
  "...######...",
  "..########..",
  ".###oooo###.",
  "###oooooo###",
  "##ooo##ooo##",
  "##oo####oo##",
  "##o######o##",
  "##ooo##ooo##",
  "##ooo##ooo##",
  "##ooo##ooo##",
  "##ooo##ooo##",
  "##ooo##ooo##",
  "##ooo##ooo##",
  "##oooooooo##",
  "############",
  "############",
];
ART.exitA = sprite(EXIT_ROWS);
// The second frame swaps the arrow's colours so the exit blinks
ART.exitB = sprite(EXIT_ROWS.map(function (row, y) {
  if (y < 3 || y > 13) return row;
  return row.slice(0, 2) + row.slice(2, 10).replace(/[#o]/g, function (c) {
    return c === "#" ? "o" : "#";
  }) + row.slice(10);
}));

var GUN = sprite([
  ".........####.........",
  ".........#oo#.........",
  ".........#oo#.........",
  "........######........",
  "........#oooo#........",
  ".......##o##o##.......",
  ".......#oo##oo#.......",
  "......##oo##oo##......",
  "......#ooo##ooo#......",
  ".....##oooooooo##.....",
  ".....#oo######oo#.....",
  "....##o#oooooo#o##....",
  "....#oo#oooooo#oo#....",
  "...##ooo######ooo##...",
  "...#oooooooooooooo#...",
  "..##oo#oo#oo#oo#oo##..",
  "..#ooo#oo#oo#oo#ooo#..",
  ".##oooooooooooooooo##.",
]);
var FLASH = sprite([
  "#...#...#",
  ".#.###.#.",
  "..#####..",
  "#########",
  "..#####..",
  ".#.###.#.",
  "#...#...#",
]);
var ICONS = {
  heart: [".#.#.", "#####", "#####", ".###.", "..#.."],
  bullet: [".#.", "###", "###", "###", "###"],
  skull: [".###.", "#####", "#.#.#", "#####", ".#.#."],
};

var KINDS = {
  grunt: { hp: 2, speed: 1.5, size: 0.85, lift: 0 },
  orb: { hp: 2, speed: 1.0, size: 0.55, lift: 0.25 },
  medkit: { size: 0.32, lift: 0 },
  ammo: { size: 0.32, lift: 0 },
  exit: { size: 0.85, lift: 0 },
  shot: { size: 0.2, lift: 0.4 },
};

// ---------------------------------------------------------------- canvas
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
canvas.width = W;
canvas.height = H;
lcd.fit(canvas, W, H);
var image = ctx.createImageData(W, H);
var buf = new Uint8Array(W * H);
var zbuf = new Float32Array(W);

// ---------------------------------------------------------------- state
var game = {
  level: 0,
  map: [],
  mapW: 0,
  mapH: 0,
  seen: null,
  things: [],
  totalEnemies: 0,
  kills: 0,
  playing: false,
};
var player = { x: 0, y: 0, angle: 0, hp: MAX_HP, ammo: START_AMMO, cool: 0, flash: 0, hurt: 0, bob: 0 };
var levelStart = { hp: MAX_HP, ammo: START_AMMO };
var held = {};
var showMap = false;
var clock = 0;

function stop() {
  window.bridge.send(window.parent, { event: "stop" });
}

function playAudio(id) {
  window.bridge.send(window.parent, { event: "playAudio", data: id });
}

function shake() {
  window.bridge.send(window.parent, { event: "shake", data: "LIGHT" });
}

// Tells the phone a run has ended. The phone may show an ad at this moment.
function sendGameOver() {
  window.bridge.send(window.parent, { event: "progress", data: { type: "over" } });
}

function loadLevel(index) {
  var def = LEVELS[index];
  game.level = index;
  game.map = def.map.map(function (row) {
    return row.split("");
  });
  game.mapH = game.map.length;
  game.mapW = def.map[0].length;
  game.seen = new Uint8Array(game.mapW * game.mapH);
  game.flow = new Int16Array(game.mapW * game.mapH);
  game.flowAt = 0;
  game.things = [];
  game.totalEnemies = 0;
  game.kills = 0;
  for (var y = 0; y < game.mapH; y++) {
    for (var x = 0; x < game.mapW; x++) {
      var c = game.map[y][x];
      var kind = { g: "grunt", o: "orb", h: "medkit", a: "ammo", X: "exit" }[c];
      if (c === "P") {
        player.x = x + 0.5;
        player.y = y + 0.5;
      }
      if (kind) addThing(kind, x + 0.5, y + 0.5);
      if (c === "g" || c === "o") game.totalEnemies++;
      if (!TEXTURES[c]) game.map[y][x] = ".";
    }
  }
  player.angle = def.angle;
  player.hp = levelStart.hp;
  player.ammo = levelStart.ammo;
  player.cool = 0;
  player.flash = 0;
  player.hurt = 0;
  held = {};
  game.playing = true;
}

function addThing(kind, x, y) {
  var k = KINDS[kind];
  var t = { kind: kind, x: x, y: y, hp: k.hp || 0, awake: false, dead: false, cool: 1 + Math.random(), atk: 0, flash: 0, walk: 0 };
  game.things.push(t);
  return t;
}

function newGame() {
  levelStart = { hp: MAX_HP, ammo: START_AMMO };
  loadLevel(0);
}

// ---------------------------------------------------------------- world helpers
function solid(x, y) {
  var mx = Math.floor(x);
  var my = Math.floor(y);
  if (mx < 0 || my < 0 || mx >= game.mapW || my >= game.mapH) return true;
  return !!TEXTURES[game.map[my][mx]];
}

/** Moves with sliding along walls, keeping `r` away from them. */
function move(e, dx, dy, r) {
  var nx = e.x + dx;
  if (!solid(nx + (dx > 0 ? r : -r), e.y - r) && !solid(nx + (dx > 0 ? r : -r), e.y + r)) e.x = nx;
  var ny = e.y + dy;
  if (!solid(e.x - r, ny + (dy > 0 ? r : -r)) && !solid(e.x + r, ny + (dy > 0 ? r : -r))) e.y = ny;
}

function lineOfSight(ax, ay, bx, by) {
  var dx = bx - ax;
  var dy = by - ay;
  var steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) / 0.15);
  for (var i = 1; i < steps; i++) {
    if (solid(ax + (dx * i) / steps, ay + (dy * i) / steps)) return false;
  }
  return true;
}

/** Steps from every floor cell to the player, so monsters can walk around walls. */
function updateFlow() {
  var w = game.mapW;
  var flow = game.flow;
  for (var i = 0; i < flow.length; i++) flow[i] = -1;
  var start = Math.floor(player.y) * w + Math.floor(player.x);
  var queue = [start];
  flow[start] = 0;
  for (var q = 0; q < queue.length; q++) {
    var c = queue[q];
    var cx = c % w;
    var cy = (c - cx) / w;
    var next = [c - 1, c + 1, c - w, c + w];
    var ok = [cx > 0, cx < w - 1, cy > 0, cy < game.mapH - 1];
    for (var n = 0; n < 4; n++) {
      var j = next[n];
      if (!ok[n] || flow[j] !== -1) continue;
      if (TEXTURES[game.map[(j - (j % w)) / w][j % w]]) continue;
      flow[j] = flow[c] + 1;
      queue.push(j);
    }
  }
}

/** Walks straight at the player when it sees them, else down the flow field. */
function walkToward(t, sees, ux, uy, speed) {
  if (sees) {
    var ox = t.x;
    var oy = t.y;
    move(t, ux * speed, uy * speed, 0.25);
    var moved = Math.abs(t.x - ox) + Math.abs(t.y - oy);
    if (moved > speed * 0.5) return;
    // Seen through a gap but blocked by a corner, so follow the flow field instead
    t.x = ox;
    t.y = oy;
  }
  var go = chaseDir(t);
  move(t, go[0] * speed, go[1] * speed, 0.25);
}

/** The way down the flow field from a monster's cell. */
function chaseDir(t) {
  var w = game.mapW;
  var cx = Math.floor(t.x);
  var cy = Math.floor(t.y);
  var best = game.flow[cy * w + cx];
  var tx = cx;
  var ty = cy;
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
    var nx = cx + d[0];
    var ny = cy + d[1];
    if (nx < 0 || ny < 0 || nx >= w || ny >= game.mapH) return;
    var f = game.flow[ny * w + nx];
    if (f !== -1 && (best === -1 || f < best)) {
      best = f;
      tx = nx;
      ty = ny;
    }
  });
  var dx = tx + 0.5 - t.x;
  var dy = ty + 0.5 - t.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.05) return [0, 0];
  return [dx / len, dy / len];
}

function camera() {
  var dirX = Math.cos(player.angle);
  var dirY = Math.sin(player.angle);
  return { dirX: dirX, dirY: dirY, planeX: -dirY * PLANE, planeY: dirX * PLANE };
}

/** Where a world point lands in camera space: x across the plane, y the depth. */
function toCamera(cam, x, y) {
  var rx = x - player.x;
  var ry = y - player.y;
  var inv = 1 / (cam.planeX * cam.dirY - cam.dirX * cam.planeY);
  return {
    x: inv * (cam.dirY * rx - cam.dirX * ry),
    y: inv * (-cam.planeY * rx + cam.planeX * ry),
  };
}

// ---------------------------------------------------------------- update
function update(dt) {
  clock += dt;
  var cam = camera();
  var fwd = (held[2] || held.up ? 1 : 0) - (held[8] || held.down ? 1 : 0);
  var turn = (held[6] || held[9] ? 1 : 0) - (held[4] || held[7] ? 1 : 0);
  var strafe = (held[3] ? 1 : 0) - (held[1] ? 1 : 0);

  player.angle += turn * TURN_SPEED * dt;
  var step = MOVE_SPEED * dt;
  var mx = cam.dirX * fwd * step + (cam.planeX / PLANE) * strafe * step * 0.8;
  var my = cam.dirY * fwd * step + (cam.planeY / PLANE) * strafe * step * 0.8;
  move(player, mx, my, PLAYER_R);
  if (fwd || strafe) player.bob += dt * 9;

  player.cool -= dt;
  player.flash -= dt;
  player.hurt -= dt;
  if ((held[5] || held.ok) && player.cool <= 0) fire(cam);

  game.flowAt -= dt;
  if (game.flowAt <= 0) {
    updateFlow();
    game.flowAt = 0.3;
  }

  var list = game.things.slice();
  for (var i = 0; i < list.length; i++) updateThing(list[i], dt, cam);
}

function fire(cam) {
  player.cool = FIRE_COOLDOWN;
  if (player.ammo <= 0) {
    playAudio("hit");
    return;
  }
  player.ammo--;
  player.flash = 0.09;
  playAudio("shoot");

  var best = null;
  var bestDepth = zbuf[W / 2];
  game.things.forEach(function (t) {
    if (t.dead || (t.kind !== "grunt" && t.kind !== "orb")) return;
    var dx = t.x - player.x;
    var dy = t.y - player.y;
    if (dx * dx + dy * dy < 81) t.awake = true; // the noise wakes nearby monsters
    var c = toCamera(cam, t.x, t.y);
    if (c.y < 0.2 || c.y >= bestDepth) return;
    var screenX = (W / 2) * (1 + c.x / c.y);
    var halfW = ((FOCAL / c.y) * KINDS[t.kind].size) * 0.4 + 1;
    if (Math.abs(screenX - W / 2) <= halfW) {
      best = t;
      bestDepth = c.y;
    }
  });
  if (best) hitMonster(best);
}

function hitMonster(t) {
  t.hp--;
  t.flash = 0.15;
  t.awake = true;
  if (t.hp <= 0) {
    t.dead = true;
    game.kills++;
    playAudio("kill");
  } else {
    playAudio("hit");
  }
}

function hurtPlayer(amount) {
  if (!game.playing) return;
  player.hp = Math.max(0, player.hp - amount);
  player.hurt = 0.25;
  playAudio("hurt");
  shake();
  if (player.hp <= 0) die();
}

function updateThing(t, dt, cam) {
  var dx = player.x - t.x;
  var dy = player.y - t.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  t.flash -= dt;
  t.atk -= dt;

  if (t.kind === "shot") {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    if (dist < 0.35) {
      remove(t);
      hurtPlayer(10);
    } else if (solid(t.x, t.y)) {
      remove(t);
    }
    return;
  }

  if (t.kind === "medkit" || t.kind === "ammo") {
    if (dist > 0.5) return;
    if (t.kind === "medkit" && player.hp >= MAX_HP) return;
    if (t.kind === "ammo" && player.ammo >= MAX_AMMO) return;
    if (t.kind === "medkit") player.hp = Math.min(MAX_HP, player.hp + 25);
    if (t.kind === "ammo") player.ammo = Math.min(MAX_AMMO, player.ammo + 8);
    playAudio("pickup");
    remove(t);
    return;
  }

  if (t.kind === "exit") {
    if (dist < 0.6) finishLevel();
    return;
  }

  if (t.dead) return;
  var sees = dist < 12 && lineOfSight(t.x, t.y, player.x, player.y);
  if (!t.awake) {
    if (sees && dist < 9) t.awake = true;
    return;
  }
  var ux = dx / (dist || 1);
  var uy = dy / (dist || 1);
  var speed = KINDS[t.kind].speed * dt;
  t.cool -= dt;

  if (t.kind === "grunt") {
    if (dist > 0.75 && t.atk <= 0) {
      walkToward(t, sees, ux, uy, speed);
      t.walk += dt * 6;
    }
    if (dist < 0.95 && t.cool <= 0) {
      t.atk = 0.35;
      t.cool = 0.9;
      hurtPlayer(8);
    }
  }

  if (t.kind === "orb") {
    if (!sees || dist > 4) {
      walkToward(t, sees, ux, uy, speed);
    } else if (dist < 2.5) {
      move(t, -ux * speed, -uy * speed, 0.25);
    }
    if (sees && t.cool <= 0 && dist < 10) {
      t.cool = 1.7 + Math.random();
      t.atk = 0.3;
      var s = addThing("shot", t.x + ux * 0.3, t.y + uy * 0.3);
      s.vx = ux * 4.5;
      s.vy = uy * 4.5;
      playAudio("zap");
    }
  }
}

function remove(t) {
  var i = game.things.indexOf(t);
  if (i !== -1) game.things.splice(i, 1);
}

// ---------------------------------------------------------------- flow
function die() {
  game.playing = false;
  held = {};
  playAudio("over");
  sendGameOver();
  ui.confirm({
    text: "You died",
    info: "Level " + (game.level + 1),
    action: "Retry",
    onDone: function (screen) {
      screen.close();
      loadLevel(game.level);
    },
    onBack: stop,
  });
}

function finishLevel() {
  game.playing = false;
  held = {};
  playAudio("exit");
  var next = game.level + 1;
  if (next >= LEVELS.length) {
    sendGameOver();
    ui.confirm({
      text: "You escaped!",
      action: "Again",
      onDone: function (screen) {
        screen.close();
        newGame();
      },
      onBack: stop,
    });
    return;
  }
  levelStart = { hp: Math.max(player.hp, 50), ammo: Math.max(player.ammo, 12) };
  ui.result({
    message: "Level " + (next + 1),
    type: "done",
    onClose: function () {
      loadLevel(next);
    },
  });
}

function openPause() {
  held = {};
  ui.list({
    title: "Paused",
    items: ["Resume", "Restart level", "How to play", "Quit"],
    onSelect: function (index, screen) {
      if (index === 0) screen.close();
      if (index === 1) {
        screen.close();
        loadLevel(game.level);
      }
      if (index === 2) showHelp();
      if (index === 3) stop();
    },
  });
}

function showHelp() {
  ui.text({
    title: "How to play",
    text:
      "2/8 walk, 4/6 turn, 1/3 strafe. Hold 5 or OK to shoot. " +
      "Hold 0 for the map. Find the blinking exit on each floor. " +
      "C pauses.",
  });
}

function openTitle() {
  ui.list({
    title: "Grim Bunker",
    items: ["New game", "How to play"],
    action: "Select",
    onSelect: function (index, screen) {
      if (index === 0) {
        screen.close();
        newGame();
      }
      if (index === 1) showHelp();
    },
    onBack: stop,
  });
}

// ---------------------------------------------------------------- render
function px(x, y, v) {
  if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = v;
}

function renderWalls(cam) {
  var x, y;
  var lastTexX = -1;
  var lastWall = -1;
  var lastSide = -1;
  for (x = 0; x < W; x++) {
    var cameraX = (2 * (x + 0.5)) / W - 1;
    var rdx = cam.dirX + cam.planeX * cameraX;
    var rdy = cam.dirY + cam.planeY * cameraX;
    var mapX = Math.floor(player.x);
    var mapY = Math.floor(player.y);
    var deltaX = rdx === 0 ? 1e9 : Math.abs(1 / rdx);
    var deltaY = rdy === 0 ? 1e9 : Math.abs(1 / rdy);
    var stepX = rdx < 0 ? -1 : 1;
    var stepY = rdy < 0 ? -1 : 1;
    var sideX = rdx < 0 ? (player.x - mapX) * deltaX : (mapX + 1 - player.x) * deltaX;
    var sideY = rdy < 0 ? (player.y - mapY) * deltaY : (mapY + 1 - player.y) * deltaY;
    var side = 0;
    var cell = ".";
    for (var guard = 0; guard < 64; guard++) {
      if (sideX < sideY) {
        sideX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += deltaY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= game.mapW || mapY >= game.mapH) {
        cell = "#";
        break;
      }
      game.seen[mapY * game.mapW + mapX] = 1;
      cell = game.map[mapY][mapX];
      if (TEXTURES[cell]) break;
    }
    var perp = Math.max(0.05, side === 0 ? sideX - deltaX : sideY - deltaY);
    zbuf[x] = perp;

    var lineH = FOCAL / perp;
    var top = HORIZON - lineH / 2;
    var bottom = HORIZON + lineH / 2;
    var wallX = side === 0 ? player.y + perp * rdy : player.x + perp * rdx;
    wallX -= Math.floor(wallX);
    var texX = Math.floor(wallX * TEX);
    if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) texX = TEX - 1 - texX;
    var tex = TEXTURES[cell] || TEXTURES["#"];
    // Further walls get a little dither, and one wall direction a little extra, for depth
    var fog = Math.min(5, Math.floor(perp * 0.5)) + (side ? 2 : 0);
    // A far wall is too small to show its texture, so it becomes a plain tone instead of noise
    if (lineH < 12) tex = TEXTURES.blank;
    var y0 = Math.max(0, Math.ceil(top - 0.5));
    var y1 = Math.min(VIEW_H - 1, Math.floor(bottom - 0.5));
    var wallId = mapY * 4096 + mapX * 2 + side;
    var colFirst = texX !== lastTexX || wallId !== lastWall;
    // A corner or a jump in depth gets a full dark edge
    var edge = x > 0 && (wallId !== lastWall) && (side !== lastSide || Math.abs(perp - zbuf[x - 1]) > 0.4);
    lastTexX = texX;
    lastWall = wallId;
    lastSide = side;

    var prevTexY = -1;
    for (y = y0; y <= y1; y++) {
      var texY = Math.floor(((y + 0.5 - top) / lineH) * TEX) & (TEX - 1);
      var rowFirst = texY !== prevTexY;
      prevTexY = texY;
      var t = tex[texY * TEX + texX];
      var dark =
        edge ||
        (t === T_H && rowFirst) ||
        (t === T_V && colFirst) ||
        (t === T_D && rowFirst && colFirst) ||
        BAYER[(y & 3) * 4 + (x & 3)] < fog;
      if ((y === y0 && top > 0) || (y === y1 && bottom < VIEW_H)) dark = true;
      buf[y * W + x] = dark ? 1 : 0;
    }

    // Checkered floor, cast row by row
    for (y = y1 + 1; y < VIEW_H; y++) {
      var rowDist = (FOCAL * 0.5) / (y + 0.5 - HORIZON);
      var fx = player.x + rowDist * rdx;
      var fy = player.y + rowDist * rdy;
      var odd = (Math.floor(fx) + Math.floor(fy)) & 1;
      var level = rowDist > 7 ? 1 : odd ? 4 : 0;
      buf[y * W + x] = BAYER[(y & 3) * 4 + (x & 3)] < level ? 1 : 0;
    }
  }
}

var stamp = new Uint32Array(W * VIEW_H);
var stampId = 0;
var darkList = new Int32Array(W * VIEW_H);

/**
 * Draws a scaled sprite, hidden behind nearer walls when `depth` is set. Its dark pixels then get a
 * 1 pixel light ring on screen, so a sprite stands out from busy walls at any size.
 */
function drawArt(art, left, top, sw, sh, depth, invert) {
  stampId++;
  var count = 0;
  var x0 = Math.max(0, Math.floor(left));
  var x1 = Math.min(W - 1, Math.ceil(left + sw) - 1);
  var y0 = Math.max(0, Math.floor(top));
  var y1 = Math.min(VIEW_H - 1, Math.ceil(top + sh) - 1);
  var x, y, i;
  for (x = x0; x <= x1; x++) {
    if (depth && depth >= zbuf[x]) continue;
    var u = Math.min(art.w - 1, Math.max(0, Math.floor(((x + 0.5 - left) / sw) * art.w)));
    for (y = y0; y <= y1; y++) {
      var v = Math.min(art.h - 1, Math.max(0, Math.floor(((y + 0.5 - top) / sh) * art.h)));
      var val = art.d[v * art.w + u];
      if (!val) continue;
      var dark = (val === 1) !== !!invert;
      i = y * W + x;
      if (dark) {
        stamp[i] = stampId;
        darkList[count++] = i;
      } else {
        buf[i] = 0;
      }
    }
  }
  if (invert) {
    for (var n = 0; n < count; n++) buf[darkList[n]] = 1;
    return;
  }
  for (var k = 0; k < count; k++) {
    i = darkList[k];
    x = i % W;
    y = (i - x) / W;
    ring(x - 1, y, depth);
    ring(x + 1, y, depth);
    ring(x, y - 1, depth);
    ring(x, y + 1, depth);
  }
  for (var m = 0; m < count; m++) buf[darkList[m]] = 1;
}

function ring(x, y, depth) {
  if (x < 0 || y < 0 || x >= W || y >= VIEW_H) return;
  if (depth && depth >= zbuf[x]) return;
  var i = y * W + x;
  if (stamp[i] !== stampId) buf[i] = 0;
}

function artFor(t) {
  var walk = Math.floor(t.walk) % 2;
  if (t.kind === "grunt") return t.dead ? ART.gruntDead : t.atk > 0 ? ART.gruntAtk : walk ? ART.gruntB : ART.gruntA;
  if (t.kind === "orb") return t.dead ? ART.orbDead : t.atk > 0 ? ART.orbAtk : ART.orb;
  if (t.kind === "exit") return Math.floor(clock * 3) % 2 ? ART.exitB : ART.exitA;
  return ART[t.kind];
}

function renderThings(cam) {
  var list = game.things.map(function (t) {
    return { t: t, c: toCamera(cam, t.x, t.y) };
  });
  list.sort(function (a, b) {
    return b.c.y - a.c.y;
  });
  list.forEach(function (item) {
    var t = item.t;
    var c = item.c;
    if (c.y < 0.15) return;
    var k = KINDS[t.kind];
    var art = artFor(t);
    var screenX = (W / 2) * (1 + c.x / c.y);
    var bob = t.kind === "orb" && !t.dead ? Math.sin(clock * 4 + t.x) * 0.04 : 0;
    var lift = t.dead ? 0 : k.lift + bob;
    var sh = (FOCAL / c.y) * k.size;
    var sw = (sh * art.w) / art.h;
    var bottom = HORIZON + (FOCAL * 0.5) / c.y - (lift * FOCAL) / c.y;
    drawArt(art, screenX - sw / 2, bottom - sh, sw, sh, c.y, t.flash > 0);
  });
}

function renderGun() {
  var moving = held[2] || held[8] || held[1] || held[3] || held.up || held.down;
  var bobX = moving ? Math.round(Math.sin(player.bob) * 2) : 0;
  var bobY = moving ? Math.round(Math.abs(Math.cos(player.bob)) * 2) : 0;
  var kick = player.flash > 0 ? -2 : 0;
  var gx = Math.round(W / 2 - GUN.w / 2) + bobX;
  var gy = VIEW_H - GUN.h + 2 + bobY + kick;
  if (player.flash > 0) drawArt(FLASH, gx + GUN.w / 2 - FLASH.w / 2, gy - FLASH.h + 2, FLASH.w, FLASH.h, 0, false);
  drawArt(GUN, gx, gy, GUN.w, GUN.h, 0, false);
}

function renderCrosshair() {
  var cx = W / 2;
  var cy = HORIZON;
  px(cx, cy, 0);
  px(cx - 2, cy, 1);
  px(cx + 1, cy, 1);
  px(cx - 1, cy - 2, 0);
  px(cx, cy - 2, 1);
  px(cx, cy + 2, 1);
}

function renderHurt() {
  if (player.hurt <= 0) return;
  for (var x = 0; x < W; x++) {
    px(x, 0, 1);
    px(x, 1, 1);
    px(x, VIEW_H - 1, 1);
    px(x, VIEW_H - 2, 1);
  }
  for (var y = 0; y < VIEW_H; y++) {
    px(0, y, 1);
    px(1, y, 1);
    px(W - 1, y, 1);
    px(W - 2, y, 1);
  }
}

/** A wall shows on the map once it, or a floor cell next to it, has been seen. */
function nearSeen(mx, my) {
  var w = game.mapW;
  if (game.seen[my * w + mx]) return true;
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
    var x = mx + d[0];
    var y = my + d[1];
    if (x < 0 || y < 0 || x >= w || y >= game.mapH) return false;
    return game.seen[y * w + x] && !TEXTURES[game.map[y][x]];
  });
}

/** Top-down map of the cells seen so far, centred on the player, while 0 is held. */
function renderMap() {
  var S = 3;
  var cx = W / 2;
  var cy = VIEW_H / 2;
  for (var i = 0; i < W * VIEW_H; i++) buf[i] = 0;
  for (var my = 0; my < game.mapH; my++) {
    for (var mx = 0; mx < game.mapW; mx++) {
      if (!TEXTURES[game.map[my][mx]] || !nearSeen(mx, my)) continue;
      var sx = Math.round(cx + (mx - player.x) * S);
      var sy = Math.round(cy + (my - player.y) * S);
      for (var yy = 0; yy < S; yy++) {
        for (var xx = 0; xx < S; xx++) {
          if (sy + yy < VIEW_H) px(sx + xx, sy + yy, 1);
        }
      }
    }
  }
  // The player as a dot with a short line where they face
  px(cx, cy, 1);
  for (var d = 1; d <= 3; d++) {
    px(Math.round(cx + Math.cos(player.angle) * d), Math.round(cy + Math.sin(player.angle) * d), 1);
  }
  game.things.forEach(function (t) {
    if (t.kind !== "exit" || !game.seen[Math.floor(t.y) * game.mapW + Math.floor(t.x)]) return;
    if (Math.floor(clock * 3) % 2) return;
    var ex = Math.round(cx + (t.x - player.x) * S);
    var ey = Math.round(cy + (t.y - player.y) * S);
    px(ex, ey, 1);
    px(ex - 1, ey, 1);
    px(ex + 1, ey, 1);
    px(ex, ey - 1, 1);
    px(ex, ey + 1, 1);
  });
}

function drawIcon(rows, x, y) {
  for (var r = 0; r < rows.length; r++) {
    for (var c = 0; c < rows[r].length; c++) {
      if (rows[r].charAt(c) === "#") px(x + c, y + r, 1);
    }
  }
}

function renderHud() {
  for (var x = 0; x < W; x++) px(x, VIEW_H, 1);
  drawIcon(ICONS.heart, 2, 59);
  drawIcon(ICONS.bullet, 34, 59);
  drawIcon(ICONS.skull, 60, 59);
  // The level number in a small box on the right
  for (var y = 57; y < H; y++) {
    px(86, y, 1);
    px(94, y, 1);
  }
}

function renderHudText() {
  ctx.fillStyle = "#000";
  lcd.drawText(ctx, String(player.hp), 9, 59);
  lcd.drawText(ctx, String(player.ammo), 39, 59);
  lcd.drawText(ctx, String(game.totalEnemies - game.kills), 67, 59);
  lcd.drawText(ctx, String(game.level + 1), 89, 59);
}

function render() {
  for (var i = 0; i < buf.length; i++) buf[i] = 0;
  var cam = camera();
  renderWalls(cam);
  if (showMap) {
    renderMap();
  } else {
    renderThings(cam);
    renderCrosshair();
    renderGun();
    renderHurt();
  }
  renderHud();

  var data = image.data;
  for (var p = 0; p < buf.length; p++) data[p * 4 + 3] = buf[p] ? 255 : 0;
  ctx.putImageData(image, 0, 0);
  renderHudText();
  lcd.inkCanvas(ctx);
}

// ---------------------------------------------------------------- loop & input
var last = 0;
function frame(now) {
  var dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (game.playing && !ui.isOpen()) {
    update(dt);
    if (game.playing) render();
  }
  requestAnimationFrame(frame);
}

function press(key) {
  if (!game.playing) return;
  if (key === "clear") return openPause();
  if (key === 0) showMap = true;
  held[key] = true;
}

function release(key) {
  if (key === 0) showMap = false;
  held[key] = false;
}

window.bridge.on("keypress", press);
window.bridge.on("numpress", press);
window.bridge.on("keyrelease", release);
window.bridge.on("numrelease", release);
window.bridge.on("pause", function () {
  held = {};
  showMap = false;
});
window.bridge.send(window.parent, {
  event: "loadAudio",
  data: ["shoot", "hit", "hurt", "pickup", "kill", "exit", "zap", "over"].map(function (name) {
    return location.origin + "/grim-bunker/audio/" + name + ".mp3";
  }),
});

openTitle();
requestAnimationFrame(frame);
