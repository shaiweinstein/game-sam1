/* One visit-owned catch game. No save writes, timers, global listeners, or
   camera changes. The normal beach loop advances every transition. */
import { createCharacter } from "./character3d.js";
import { CHARACTER_RADIUS, routeAroundProps } from "./collision3d.js";
import { sandY, WORLD } from "./world.js";

const PLAYER = { x: 1.2, z: 2.7 }, FRIEND = { x: -1.25, z: 2.4 };
const NPC_BOUNDS = { ...WORLD.box, xMin: -32, xMax: 32 };
const choose = values => values[Math.floor(Math.random() * values.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createCatch(world, player, reducedMotion, bus) {
  const ball = world.ball;
  let phase = "ground", elapsed = 0, disposed = false, generation = 0;
  let friend = null, identity = null, friendReady = false, entered = false;
  let playerPath = [], friendPath = [], flight = null, holder = null;
  let pickupFrom = null, exit = null, catches = 0, throws = 0, lastEvent = "ground";

  const busy = () => !disposed && phase !== "ground";
  const position = () => ({ x: ball.root.position.x,
    y: ball.root.position.y + ball.radius, z: ball.root.position.z });
  function place(p) {
    ball.root.position.set(p.x, p.y - ball.radius, p.z);
    const ground = sandY(p.x, p.z);
    ball.shadow.position.y = ground - ball.root.position.y + 0.006;
    ball.shadow.material.opacity = 0.75 / (1 + Math.max(0, p.y - ground - ball.radius));
  }
  function heldAt(actor) {
    const a = actor.getAnchor(), yaw = actor.loco.yaw;
    return { x: a.x + Math.sin(yaw) * 0.48, y: actor.getRootY() + 0.5,
      z: a.z + Math.cos(yaw) * 0.48 };
  }
  function setPhase(next, message) {
    phase = next; elapsed = 0; lastEvent = next;
    if (message) bus.say(message);
    syncUI();
  }
  function syncUI() {
    const throwButton = document.querySelector('[data-activity-id="catchthrow"]');
    if (throwButton) throwButton.disabled = phase !== "ready";
    const stopButton = document.querySelector('[data-activity-id="catchstop"]');
    if (stopButton) stopButton.disabled = phase === "dropping" || phase === "leaving";
  }
  function removeFriend() {
    generation++;
    friend?.dispose(); friend = null;
    friendReady = entered = false; friendPath = [];
  }
  function route(actor, target, bounds) {
    return routeAroundProps(actor.getAnchor(), target, world.obstacles(), bounds);
  }
  function follow(actor, path) {
    if (!path?.length) return true;
    const a = actor.getAnchor(), goal = path[0];
    if (Math.hypot(a.x - goal.x, a.z - goal.z) < 0.025) path.shift();
    if (path.length) actor.setTarget(path[0].x, path[0].z, "catch");
    else actor.clearTarget();
    return path.length === 0;
  }
  function idlePlayer() {
    player.clearTarget(); player.setEnabled(true); player.setBallPose(null);
    player.loco.vx = player.loco.vz = 0;
    playerPath = [];
  }
  function finish() {
    removeFriend(); idlePlayer();
    holder = flight = identity = null;
    setPhase("ground", "That was fun! Tap the ball whenever you want to play again.");
    window.BeachScene?.setMode("sand");
  }
  function entrance() {
    const rect = world.canvas.getBoundingClientRect();
    let x = -8;
    while (x > NPC_BOUNDS.xMin + 1 && world.project(x, 0.7, FRIEND.z).x > rect.left - 100) x -= 2;
    return { x, z: FRIEND.z };
  }

  function start() {
    if (disposed || busy() || !player.actionInfo().clip || !bus.canStart()) return false;
    const playerId = window.GameState?.getCharacter?.().id || "lily";
    const displayedId = player.appearance().friend;
    const candidates = Object.keys(window.CHARACTERS || {}).filter(id => id !== playerId && id !== displayedId);
    if (!candidates.length) return false;
    const p = position();
    // Stand beside the disc, not at its centre: pickup never disables collision.
    const target = { x: p.x - 0.68, z: p.z };
    playerPath = route(player, target, WORLD.box);
    if (!playerPath) { bus.say("Walk a little closer to the ball, then tap it again!"); return false; }
    bus.beforeStart();
    player.clearTarget();
    catches = throws = 0;
    identity = { id: choose(candidates), suit: "suit" + (1 + Math.floor(Math.random() * 6)),
      hair: "hair" + (1 + Math.floor(Math.random() * 6)) };
    friend = createCharacter(world.renderer, world.scene, reducedMotion, null,
      { obstacles: world.obstacles, bounds: NPC_BOUNDS, speedScale: 3 });
    friend.root.name = "catchFriend";
    friend.setVisible(false);
    exit = entrance(); friend.teleport(exit.x, exit.z);
    friend.setSuit(identity.suit); friend.setHair(identity.hair); friend.setFriend(identity.id);
    const token = ++generation, loading = friend;
    loading.ready.then(async ok => {
      if (disposed || token !== generation) return;
      const applied = ok && await loading.setFriend(identity.id);
      if (disposed || token !== generation) return;
      if (!applied) { stop(); bus.say("Our friend is not ready yet. Let's try again in a moment!"); return; }
      friendReady = true;
    });
    window.BeachScene?.setMode("catch");
    setPhase("approach", "Let's pick up the ball! A friend is coming to play.");
    return true;
  }

  function throwBall() {
    if (disposed || phase !== "ready") return false;
    throws++;
    setPhase("windup", "Here it comes, " + window.CHARACTERS[identity.id].name + "!");
    return true;
  }
  function launch(to, next) {
    flight = { from: position(), to: heldAt(to), time: 0, duration: 0.95, arc: 1.05 };
    holder = null;
    to.setBallPose("catch");
    setPhase(next);
  }
  function dropTarget() {
    const p = position();
    const actors = [player, ...(entered && friend ? [friend] : [])].map(c => c.getAnchor());
    for (let ring = 0; ring < 5; ring++) for (let i = 0; i < 16; i++) {
      const x = clamp(p.x + ring * 0.4 * Math.cos(i * Math.PI / 8), WORLD.box.xMin + 0.8, WORLD.box.xMax - 0.3);
      const z = clamp(p.z + ring * 0.4 * Math.sin(i * Math.PI / 8), 1.2, WORLD.box.zMax - 0.3);
      if (actors.some(a => Math.hypot(x - a.x, z - a.z) < ball.radius + CHARACTER_RADIUS + 0.08)) continue;
      if (world.obstacles().some(o => o.id !== "ball" && Math.hypot(x - o.x, z - o.z) < o.radius + ball.radius + 0.08)) continue;
      return { x, y: sandY(x, z) + ball.radius, z };
    }
    return { x: 0, y: sandY(0, 3.8) + ball.radius, z: 3.8 };
  }
  function stop() {
    if (disposed || !busy() || phase === "dropping" || phase === "leaving") return false;
    player.clearTarget(); playerPath = [];
    friend?.clearTarget(); friendPath = [];
    player.setBallPose(null); friend?.setBallPose(null);
    holder = null;
    // A friend still loading must never materialize after Stop or close.
    if (!entered) removeFriend();
    if (ball.grounded) { finish(); return true; }
    flight = { from: position(), to: dropTarget(), time: 0, duration: 0.5, arc: 0 };
    setPhase("dropping", "Let's put the ball down. Thanks for playing!");
    return true;
  }
  function syncIdentity(id) {
    if (!friend || identity?.id !== id) return;
    // Hide before the player's async palette swap: never show two of one friend.
    removeFriend();
    if (phase === "leaving") finish();
    else stop();
  }

  function tapped(ev, point, radius) {
    const center = world.project(point.x, point.y, point.z);
    const edge = world.project(point.x + radius, point.y, point.z);
    return !center.behind && Math.hypot(ev.clientX - center.x, ev.clientY - center.y) <= Math.max(22, Math.abs(edge.x - center.x));
  }
  function onPointerDown(ev) {
    if (disposed) return false;
    if (!busy()) return tapped(ev, position(), ball.radius) ? (start(), true) : false;
    if (phase === "ready" && (tapped(ev, position(), ball.radius) ||
        tapped(ev, { ...friend.getAnchor(), y: friend.getRootY() + 0.5 }, 0.5))) throwBall();
    return true;
  }

  function update(dt, waveT) {
    if (disposed) return;
    syncUI();
    if (!busy()) return;
    elapsed += dt;
    if (phase === "approach" && follow(player, playerPath)) {
      player.facePoint(ball.root.position.x, ball.root.position.z);
      pickupFrom = position();
      setPhase("pickup", "Got it! Let's make room for our friend.");
    } else if (phase === "approach" && elapsed > 30) {
      stop();
    } else if (phase === "pickup") {
      player.setBallPose("pickup", Math.min(1, elapsed / 0.8));
      if (elapsed >= 0.3) {
        ball.grounded = false;
        const target = heldAt(player), u = clamp((elapsed - 0.3) / 0.5, 0, 1);
        place({ x: pickupFrom.x + (target.x - pickupFrom.x) * u,
          y: pickupFrom.y + (target.y - pickupFrom.y) * u,
          z: pickupFrom.z + (target.z - pickupFrom.z) * u });
      }
      if (elapsed >= 0.8) {
        holder = player; player.setBallPose("hold");
        playerPath = route(player, PLAYER, WORLD.box);
        if (!playerPath) { stop(); return; }
        setPhase("entering", "Our friend is on the way!");
      }
    } else if (phase === "entering") {
      if (friendReady && !entered) {
        entered = true; friend.setVisible(true);
        friendPath = route(friend, FRIEND, NPC_BOUNDS);
        if (!friendPath) { stop(); return; }
      }
      const playerThere = follow(player, playerPath);
      const friendThere = entered && follow(friend, friendPath);
      if (playerThere && friendThere) {
        player.facePoint(FRIEND.x, FRIEND.z); friend.facePoint(PLAYER.x, PLAYER.z);
        friend.setBallPose("catch");
        setPhase("ready", window.CHARACTERS[identity.id].name + " is ready! Tap the ball or press Throw ball.");
      } else if (elapsed > 20) stop();
    } else if (phase === "ready") {
      player.setBallPose("hold"); friend.setBallPose("catch");
    } else if (phase === "windup" || phase === "returnWindup") {
      const actor = phase === "windup" ? player : friend;
      actor.setBallPose("throw", Math.min(1, elapsed / 0.3));
      if (elapsed >= 0.3) launch(actor === player ? friend : player, actor === player ? "outbound" : "inbound");
    } else if (phase === "friendCatch") {
      friend.setBallPose("hold");
      if (elapsed >= 0.7) setPhase("returnWindup", "Nice catch! Here's one for you!");
    } else if (phase === "playerCatch") {
      player.setBallPose("catch");
      if (elapsed >= 0.45) setPhase("ready", "You caught it! " + catches + " catches together. Throw again!");
    } else if (phase === "leaving") {
      if (!friend || follow(friend, friendPath)) finish();
    }
    friend?.update(dt, waveT);
    if (holder) place(heldAt(holder));
    if (flight) {
      const f = flight;
      const u = Math.min(1, (f.time += dt) / f.duration);
      const t = phase === "dropping" ? u * u : u;
      place({ x: f.from.x + (f.to.x - f.from.x) * t,
        y: f.from.y + (f.to.y - f.from.y) * t + 4 * f.arc * u * (1 - u),
        z: f.from.z + (f.to.z - f.from.z) * t });
      if (!reducedMotion()) ball.mesh.rotation.z += dt * 3;
      if (u === 1) {
        flight = null;
        if (phase === "dropping") {
          ball.grounded = true; idlePlayer();
          if (friend) {
            friendPath = route(friend, exit, NPC_BOUNDS);
            if (!friendPath) { finish(); return; }
            setPhase("leaving", "See you next time! Our friend is walking home.");
          } else finish();
        } else {
          catches++;
          holder = phase === "outbound" ? friend : player;
          holder.setBallPose("catch");
          bus.sound?.("pop");
          setPhase(holder === friend ? "friendCatch" : "playerCatch", holder === friend ? "Your friend caught it!" : "Lovely catch!");
        }
      }
    }
  }

  const activities = [
    { id: "catchplay", label: "Play catch", only3D: true, modes: ["sand"], onClick: start },
    { id: "catchthrow", label: "Throw ball", only3D: true, modes: ["catch"], onClick: throwBall },
    { id: "catchstop", label: "Stop playing", only3D: true, modes: ["catch"], onClick: stop }
  ];
  for (const spec of activities) window.BeachScene?.registerActivity(spec);
  return {
    start, stop, throwBall, busy, onPointerDown, syncIdentity, update,
    state: () => disposed ? null : ({ phase, elapsed, busy: busy(), canThrow: phase === "ready", catches, throws, lastEvent,
      holder: holder === player ? "player" : holder ? "friend" : null,
      ball: { ...position(), grounded: ball.grounded, radius: ball.radius },
      flight: flight && { ...flight, from: { ...flight.from }, to: { ...flight.to } },
      friend: friend && { ...identity, ready: friendReady, entered, ...friend.getAnchor(),
        appearance: friend.appearance(), action: friend.actionInfo() },
      playerPath: playerPath.map(p => ({ ...p })), friendPath: friendPath.map(p => ({ ...p })) }),
    dispose() {
      if (disposed) return;
      disposed = true; removeFriend(); idlePlayer();
      holder = flight = null;
      for (const spec of activities) window.BeachScene?.unregisterActivity(spec.id, spec);
    }
  };
}
