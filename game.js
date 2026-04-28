// RimWorld Clone - Core Game Engine

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game State
const state = {
    camera: {
        x: -8000,
        y: -8000,
        zoom: 1,
        isDragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
        dragStartX: 0,
        dragStartY: 0
    },
    map: {
        width: 500,
        height: 500,
        tileSize: 32,
        tiles: [],
        chunks: [],
        chunkSize: 16, 
        explored: null, 
        visionRadius: 20,
        fogOfWarEnabled: true
    },
    resources: {
        wood: 0,
        stone: 0,
        berries: 0
    },
    entities: [],
    jobs: [],
    time: {
        day: 1,
        hour: 8,
        minute: 0,
        tick: 0,
        speed: 1
    },
    currentOrder: null,
    selectedEntity: null
};

// Tile Types
const TILE_TYPES = {
    GRASS: { color: '#4a7c44', name: 'Grass', moveCost: 1 },
    BERRY_BUSH: { color: '#388e3c', name: 'Berry Bush', solid: true, harvestable: 'berries' },
    SOIL: { color: '#5d4037', name: 'Soil', moveCost: 1.2 },
    WATER: { color: '#1976d2', name: 'Water', moveCost: 3 },
    DEEP_WATER: { color: '#0d47a1', name: 'Deep Water', solid: true },
    STONE: { color: '#757575', name: 'Stone', solid: true, harvestable: 'stone' },
    SAND: { color: '#c2b280', name: 'Sand', moveCost: 1.5 },
    TREE: { color: '#1b5e20', name: 'Tree', solid: true, harvestable: 'wood' },
    WALL: { color: '#424242', name: 'Wall', solid: true }
};

// --- Simple Noise Generator ---
const Noise = {
    p: new Uint8Array(512),
    init() {
        const permutation = new Uint8Array(256);
        for (let i = 0; i < 256; i++) permutation[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
        }
        for (let i = 0; i < 512; i++) this.p[i] = permutation[i & 255];
    },
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); },
    lerp(t, a, b) { return a + t * (b - a); },
    grad(hash, x, y) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    },
    perlin(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = this.fade(x);
        const v = this.fade(y);
        const a = this.p[X] + Y, aa = this.p[a], ab = this.p[a + 1];
        const b = this.p[X + 1] + Y, ba = this.p[b], bb = this.p[b + 1];
        return this.lerp(v, this.lerp(u, this.grad(this.p[aa], x, y),
                                     this.grad(this.p[ba], x - 1, y)),
                            this.lerp(u, this.grad(this.p[ab], x, y - 1),
                                     this.grad(this.p[bb], x - 1, y - 1)));
    },
    fbm(x, y, octaves = 4) {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            total += this.perlin(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return (total / maxValue + 1) / 2;
    }
};
Noise.init();

function updateResourceUI() {
    document.getElementById('wood-count').textContent = state.resources.wood;
    document.getElementById('stone-count').textContent = state.resources.stone;
    document.getElementById('berries-count').textContent = state.resources.berries || 0;
}

function updateCharacterMenu() {
    const list = document.getElementById('character-list');
    if (!list) return;
    
    list.innerHTML = '';
    state.entities.forEach(ent => {
        const card = document.createElement('div');
        card.className = `character-card ${state.selectedEntity === ent ? 'selected' : ''}`;
        card.onclick = (e) => {
            e.stopPropagation();
            selectEntity(ent);
        };
        
        card.innerHTML = `
            <div class="character-avatar" style="background: ${ent.color}">👤</div>
            <div class="character-name">${ent.name}</div>
        `;
        list.appendChild(card);
    });
}

function initMap() {
    state.map.tiles = [];
    state.map.explored = new Uint8Array(state.map.width * state.map.height);
    const seedX = Math.random() * 1000;
    const seedY = Math.random() * 1000;

    for (let y = 0; y < state.map.height; y++) {
        const row = [];
        for (let x = 0; x < state.map.width; x++) {
            const nx = x + seedX;
            const ny = y + seedY;

            const continent = Noise.fbm(nx * 0.004, ny * 0.004, 3);
            const detail = Noise.fbm(nx * 0.02, ny * 0.02, 4);
            const elevation = (continent * 0.8 + detail * 0.2);
            const moisture = Noise.fbm(nx * 0.015 + 2000, ny * 0.015 + 2000, 3);

            let type;
            const sea_level = 0.42;

            if (elevation < sea_level) {
                if (elevation < sea_level - 0.15) type = TILE_TYPES.DEEP_WATER;
                else type = TILE_TYPES.WATER;
            } else {
                if (elevation < sea_level + 0.02) {
                    type = TILE_TYPES.SAND;
                } else if (elevation > 0.82) {
                    type = TILE_TYPES.STONE;
                } else {
                    if (moisture > 0.75) {
                        const rand = Math.random();
                        if (rand < 0.3) type = TILE_TYPES.TREE;
                        else if (rand < 0.45) type = TILE_TYPES.BERRY_BUSH;
                        else type = TILE_TYPES.GRASS;
                    }
                    else if (moisture > 0.44) type = TILE_TYPES.GRASS;
                    else if (moisture > 0.37) type = TILE_TYPES.SOIL;
                    else type = TILE_TYPES.SAND;
                }
            }
            
            const distFromCenter = Math.sqrt(Math.pow(x - state.map.width / 2, 2) + Math.pow(y - state.map.height / 2, 2));
            if (distFromCenter < 5) {
                if (type.solid || type === TILE_TYPES.WATER || type === TILE_TYPES.DEEP_WATER) {
                    type = TILE_TYPES.GRASS;
                }
            }
            
            row.push({ type, x, y });
        }
        state.map.tiles.push(row);
    }

    state.map.chunks = [];
    const chunksX = Math.ceil(state.map.width / state.map.chunkSize);
    const chunksY = Math.ceil(state.map.height / state.map.chunkSize);

    for (let cy = 0; cy < chunksY; cy++) {
        const row = [];
        for (let cx = 0; cx < chunksX; cx++) {
            const canvas = document.createElement('canvas');
            canvas.width = state.map.chunkSize * state.map.tileSize;
            canvas.height = state.map.chunkSize * state.map.tileSize;
            const chunk = {
                cx, cy,
                canvas: canvas,
                ctx: canvas.getContext('2d'),
                dirty: true
            };
            row.push(chunk);
        }
        state.map.chunks.push(row);
    }
    
    console.log("Map initialized");
}

function updateChunk(chunk) {
    const ctx = chunk.ctx;
    const size = state.map.chunkSize;
    const ts = state.map.tileSize;
    
    ctx.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);
    
    for (let ly = 0; ly < size; ly++) {
        for (let lx = 0; lx < size; lx++) {
            const gy = chunk.cy * size + ly;
            const gx = chunk.cx * size + lx;
            
            if (gy < state.map.height && gx < state.map.width) {
                if (state.map.fogOfWarEnabled && state.map.explored[gy * state.map.width + gx] === 0) continue;

                const tile = state.map.tiles[gy][gx];
                ctx.fillStyle = tile.type.color;
                ctx.fillRect(lx * ts, ly * ts, ts, ts);
            }
        }
    }
    chunk.dirty = false;
}

function markTileDirty(tx, ty) {
    const cx = Math.floor(tx / state.map.chunkSize);
    const cy = Math.floor(ty / state.map.chunkSize);
    if (state.map.chunks[cy] && state.map.chunks[cy][cx]) {
        state.map.chunks[cy][cx].dirty = true;
    }
}

function updateFogOfWar() {
    if (!state.map.explored) return;
    state.entities.forEach(ent => {
        const radius = state.map.visionRadius;
        const startX = Math.max(0, Math.floor(ent.x - radius));
        const endX = Math.min(state.map.width - 1, Math.floor(ent.x + radius));
        const startY = Math.max(0, Math.floor(ent.y - radius));
        const endY = Math.min(state.map.height - 1, Math.floor(ent.y + radius));

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                const distSq = Math.pow(x - ent.x, 2) + Math.pow(y - ent.y, 2);
                if (distSq < radius * radius) {
                    const idx = y * state.map.width + x;
                    if (state.map.explored[idx] === 0) {
                        state.map.explored[idx] = 1;
                        markTileDirty(x, y);
                    }
                }
            }
        }
    });
}

function isWalkable(tx, ty) {
    if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) return false;
    const tile = state.map.tiles[ty][tx];
    if (tile.type.solid) return false;
    if (tile.type === TILE_TYPES.WATER) {
        const neighbors = [
            {x: tx-1, y: ty}, {x: tx+1, y: ty},
            {x: tx, y: ty-1}, {x: tx, y: ty+1}
        ];
        const isNearLand = neighbors.some(n => {
            if (n.x < 0 || n.x >= state.map.width || n.y < 0 || n.y >= state.map.height) return false;
            const neighborTile = state.map.tiles[n.y][n.x];
            return neighborTile.type !== TILE_TYPES.WATER && 
                   neighborTile.type !== TILE_TYPES.DEEP_WATER;
        });
        return isNearLand;
    }
    return true;
}

function isPathClearOfWater(startX, startY, endX, endY) {
    const dist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const steps = Math.ceil(dist * 2);
    
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.floor(startX + (endX - startX) * t);
        const y = Math.floor(startY + (endY - startY) * t);
        
        if (x < 0 || x >= state.map.width || y < 0 || y >= state.map.height) return false;
        if (x === Math.floor(endX) && y === Math.floor(endY)) continue;

        const tile = state.map.tiles[y][x];
        if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.DEEP_WATER || tile.type.solid) {
            return false;
        }
    }
    return true;
}

function initEntities() {
    state.entities = [];
    state.entities.push({
        id: 1,
        name: 'Yarec Burmaldec',
        x: 250.5,
        y: 250.5,
        color: '#ffcc80',
        target: null,
        job: null,
        speed: 0.1,
        needs: { food: 100, rest: 100 },
        path: []
    });
    state.entities.push({
        id: 2,
        name: 'Arcenec Burmaldec',
        x: 251.5,
        y: 250.5,
        color: '#f48fb1',
        target: null,
        job: null,
        speed: 0.12,
        needs: { food: 100, rest: 100 },
        path: []
    });
    state.entities.push({
        id: 3,
        name: 'Timurec Burmaldec',
        x: 250.5,
        y: 251.5,
        color: '#90caf9',
        target: null,
        job: null,
        speed: 0.08,
        needs: { food: 100, rest: 100 },
        path: []
    });
    updateCharacterMenu();
}

function findPath(startX, startY, endX, endY) {
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    endX = Math.floor(endX);
    endY = Math.floor(endY);

    if (endX < 0 || endX >= state.map.width || endY < 0 || endY >= state.map.height) return null;
    const destTile = state.map.tiles[endY][endX];
    if (!isWalkable(endX, endY) && !destTile.type.harvestable) return null;

    const openSet = [{ x: startX, y: startY, g: 0, h: Math.abs(startX - endX) + Math.abs(startY - endY), f: 0, parent: null }];
    const closedSet = new Set();
    
    const maxIterations = 1000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        let currentIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[currentIdx].f) currentIdx = i;
        }
        const current = openSet.splice(currentIdx, 1)[0];
        
        if (current.x === endX && current.y === endY) {
            const path = [];
            let temp = current;
            while (temp) {
                path.push({ x: temp.x + 0.5, y: temp.y + 0.5 });
                temp = temp.parent;
            }
            return path.reverse();
        }

        closedSet.add(`${current.x},${current.y}`);

        const neighbors = [
            { x: current.x + 1, y: current.y },
            { x: current.x - 1, y: current.y },
            { x: current.x, y: current.y + 1 },
            { x: current.x, y: current.y - 1 }
        ];

        for (const neighbor of neighbors) {
            if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;
            const isDest = neighbor.x === endX && neighbor.y === endY;
            if (!isWalkable(neighbor.x, neighbor.y) && !isDest) continue;

            const tile = state.map.tiles[neighbor.y][neighbor.x];
            const cost = tile.type.moveCost || 1;
            const gScore = current.g + cost;
            let neighborNode = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);

            if (!neighborNode) {
                neighborNode = {
                    x: neighbor.x,
                    y: neighbor.y,
                    g: gScore,
                    h: Math.abs(neighbor.x - endX) + Math.abs(neighbor.y - endY),
                    f: 0,
                    parent: current
                };
                neighborNode.f = neighborNode.g + neighborNode.h;
                openSet.push(neighborNode);
            } else if (gScore < neighborNode.g) {
                neighborNode.g = gScore;
                neighborNode.f = neighborNode.g + neighborNode.h;
                neighborNode.parent = current;
            }
        }
    }
    return null;
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// ========== СИСТЕМА ОЧЕРЕДИ ДЕЙСТВИЙ ==========
class ActionQueue {
    constructor() {
        this.queue = [];
        this.isBusy = false;
        this.shiftPressed = false;
    }
    
    addAction(action, delay = 300) {
        this.queue.push({ action, delay });
        if (!this.isBusy) {
            this.executeNext();
        }
    }
    
    executeNext() {
        if (this.queue.length === 0) {
            this.isBusy = false;
            return;
        }
        
        this.isBusy = true;
        const { action, delay } = this.queue.shift();
        
        setTimeout(() => {
            action();
            this.executeNext();
        }, delay);
    }
    
    clear() {
        this.queue = [];
        this.isBusy = false;
    }
}

const actionQueue = new ActionQueue();

window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
        actionQueue.shiftPressed = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        actionQueue.shiftPressed = false;
    }
});

// Функция для создания команды движения
function executeMoveCommand(entity, tx, ty) {
    if (!entity) return;
    console.log(`▶️ ${entity.name} идет в ${tx},${ty}`);
    
    if (isPathClearOfWater(entity.x, entity.y, tx, ty)) {
        entity.path = [{ x: tx + 0.5, y: ty + 0.5 }];
        entity.target = entity.path[0];
        entity.job = null;
        entity.isManualMove = true;
    } else {
        const path = findPath(entity.x, entity.y, tx, ty);
        if (path) {
            entity.path = path;
            entity.target = path[0];
            entity.job = null;
            entity.isManualMove = true;
        }
    }
    updateInspectPanel(entity);
}

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('#top-bar') || 
        e.target.closest('#bottom-menu') || 
        e.target.closest('#inspect-panel') || 
        e.target.closest('#character-menu') || 
        e.target.closest('#regen-btn')) {
        return;
    }

    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
        state.camera.isDragging = true;
        state.camera.lastMouseX = e.clientX;
        state.camera.lastMouseY = e.clientY;
        state.camera.dragStartX = e.clientX;
        state.camera.dragStartY = e.clientY;
        return;
    }

    if (e.button === 0 && state.currentOrder) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            const existingJob = state.jobs.find(j => j.x === tx && j.y === ty);
            if (!existingJob) {
                let job = null;
                if (state.currentOrder === 'architect') {
                    if (state.map.tiles[ty][tx].type !== TILE_TYPES.WALL) {
                        job = { type: 'build_wall', x: tx, y: ty, progress: 0, assigned: false };
                    }
                } else if (state.currentOrder === 'chop') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.TREE || state.map.tiles[ty][tx].type === TILE_TYPES.BERRY_BUSH) {
                        job = { type: 'chop', x: tx, y: ty, progress: 0, assigned: false };
                    }
                } else if (state.currentOrder === 'mine') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.STONE) {
                        job = { type: 'mine', x: tx, y: ty, progress: 0, assigned: false };
                    }
                } else if (state.currentOrder === 'unarchitect') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.WALL) {
                        job = { type: 'destruct', x: tx, y: ty, progress: 0, assigned: false };
                    }
                }

                if (job) {
                    state.jobs.push(job);
                    if (state.selectedEntity) {
                        assignJobToEntity(state.selectedEntity, job);
                    }
                }
            }
        }
    } else if (e.button === 0 && state.selectedEntity) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        const clickedEnt = state.entities.find(ent => {
            const dx = ent.x - (worldPos.x / state.map.tileSize);
            const dy = ent.y - (worldPos.y / state.map.tileSize);
            return Math.sqrt(dx * dx + dy * dy) < 0.6;
        });

        if (clickedEnt && clickedEnt !== state.selectedEntity) {
            selectEntity(clickedEnt);
        } else if (isWalkable(tx, ty)) {
            // ★★★ НОВАЯ ЛОГИКА С ОЧЕРЕДЬЮ ★★★
            const entity = state.selectedEntity;
            
            if (actionQueue.shiftPressed) {
                console.log(`📌 Добавляю в очередь: ${entity.name} → ${tx},${ty}`);
                actionQueue.addAction(() => {
                    if (state.selectedEntity === entity) {
                        executeMoveCommand(entity, tx, ty);
                    }
                }, 300);
            } else {
                console.log(`⚡ Очищаю очередь и двигаю ${entity.name} в ${tx},${ty}`);
                actionQueue.clear();
                entity.path = [];
                entity.target = null;
                entity.job = null;
                executeMoveCommand(entity, tx, ty);
            }
        } else {
            deselectEntity();
        }
    } else if (e.button === 0 && !state.currentOrder) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        const clickedEnt = state.entities.find(ent => {
            const dx = ent.x - (worldPos.x / state.map.tileSize);
            const dy = ent.y - (worldPos.y / state.map.tileSize);
            return Math.sqrt(dx * dx + dy * dy) < 0.6;
        });

        if (clickedEnt) {
            selectEntity(clickedEnt);
        } else if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            state.selectedEntity = null;
            const tile = state.map.tiles[ty][tx];
            showInspectPanel(tile.type.name, `<p>Terrain: ${tile.type.name}</p><p>Coords: ${tx}, ${ty}</p>`);
        } else {
            deselectEntity();
        }
    }
});

function selectEntity(ent) {
    state.selectedEntity = ent;
    ent.isManualMove = false;
    updateInspectPanel(ent);
    updateCharacterMenu();
}

function deselectEntity() {
    state.selectedEntity = null;
    document.getElementById('inspect-panel').classList.add('hidden');
    updateCharacterMenu();
}

function updateInspectPanel(ent) {
    const panel = document.getElementById('inspect-panel');
    const title = document.getElementById('inspect-title');
    const content = document.getElementById('inspect-content');
    panel.classList.remove('hidden');
    title.innerText = ent.name;
    content.innerHTML = `
        <p>Status: ${ent.job ? 'Working' : (ent.target ? 'Moving' : 'Idle')}</p>
        <p>Food: ${Math.floor(ent.needs.food)}%</p>
        <p>Rest: ${Math.floor(ent.needs.rest)}%</p>
        <p style="color: #81d4fa; font-size: 0.8em;">
            ${actionQueue.shiftPressed ? '🔗 SHIFT зажат - команды в очередь' : 'Left-click to move (Hold Shift для очереди)'}
            ${actionQueue.queue.length ? ` | 📋 Очередь: ${actionQueue.queue.length}` : ''}
        </p>
    `;
}

function showInspectPanel(titleText, contentHTML) {
    const panel = document.getElementById('inspect-panel');
    const title = document.getElementById('inspect-title');
    const content = document.getElementById('inspect-content');
    panel.classList.remove('hidden');
    title.innerText = titleText;
    content.innerHTML = contentHTML;
}

function screenToWorld(screenX, screenY) {
    const x = (screenX - canvas.width / 2) / state.camera.zoom - state.camera.x;
    const y = (screenY - canvas.height / 2) / state.camera.zoom - state.camera.y;
    return { x, y };
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        deselectEntity();
    } else if (e.code === 'KeyL') {
        toggleFogOfWar();
    } else if (e.code === 'KeyH') {
        toggleUI();
    }
});

function toggleUI() {
    const uiOverlay = document.getElementById('ui-overlay');
    const isHidden = uiOverlay.classList.toggle('ui-hidden');
    console.log(`UI ${isHidden ? 'hidden' : 'visible'}`);
}

function toggleFogOfWar() {
    state.map.fogOfWarEnabled = !state.map.fogOfWarEnabled;
    for (let cy = 0; cy < state.map.chunks.length; cy++) {
        for (let cx = 0; cx < state.map.chunks[cy].length; cx++) {
            state.map.chunks[cy][cx].dirty = true;
        }
    }
}

window.addEventListener('mousemove', (e) => {
    if (state.camera.isDragging) {
        const dx = e.clientX - state.camera.lastMouseX;
        const dy = e.clientY - state.camera.lastMouseY;
        state.camera.x += dx / state.camera.zoom;
        state.camera.y += dy / state.camera.zoom;
    }
    state.camera.lastMouseX = e.clientX;
    state.camera.lastMouseY = e.clientY;
});

window.addEventListener('mouseup', (e) => {
    state.camera.isDragging = false;
});

window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, state.camera.zoom * factor));
    if (newZoom !== state.camera.zoom) {
        const mouseWorldBefore = screenToWorld(e.clientX, e.clientY);
        state.camera.zoom = newZoom;
        const mouseWorldAfter = screenToWorld(e.clientX, e.clientY);
        state.camera.x += (mouseWorldAfter.x - mouseWorldBefore.x);
        state.camera.y += (mouseWorldAfter.y - mouseWorldBefore.y);
    }
}, { passive: false });

function assignJobToEntity(ent, job) {
    if (ent.job) {
        ent.job.assigned = false;
    }
    ent.job = job;
    job.assigned = true;
    if (isPathClearOfWater(ent.x, ent.y, job.x, job.y)) {
        ent.path = [{ x: job.x + 0.5, y: job.y + 0.5 }];
        ent.target = ent.path[0];
    } else {
        const path = findPath(ent.x, ent.y, job.x, job.y);
        if (path) {
            ent.path = path;
            ent.target = path[0];
        }
    }
}

function update() {
    updateFogOfWar();
    state.time.tick++;
    if (state.time.tick % 60 === 0) {
        state.time.minute++;
        if (state.time.minute >= 60) {
            state.time.minute = 0;
            state.time.hour++;
            if (state.time.hour >= 24) {
                state.time.hour = 0;
                state.time.day++;
            }
        }
        updateTimeUI();
    }

    state.entities.forEach(ent => {
        if (state.selectedEntity === ent && !ent.isManualMove && !ent.job) return;

        if (!ent.job && !ent.target) {
            const availableJob = state.jobs.find(j => !j.assigned);
            if (availableJob) {
                assignJobToEntity(ent, availableJob);
            }
        }

        if (ent.target) {
            const dx = ent.target.x - ent.x;
            const dy = ent.target.y - ent.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.1) {
                ent.x = ent.target.x;
                ent.y = ent.target.y;
                if (ent.path && ent.path.length > 0) {
                    ent.path.shift();
                    if (ent.path.length > 0) {
                        ent.target = ent.path[0];
                    } else {
                        ent.target = null;
                        ent.isManualMove = false;
                    }
                } else {
                    ent.target = null;
                    ent.isManualMove = false;
                }
            } else {
                const tx = Math.floor(ent.x);
                const ty = Math.floor(ent.y);
                let speedMult = 1;
                if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
                    const tile = state.map.tiles[ty][tx];
                    speedMult = 1 / (tile.type.moveCost || 1);
                }
                ent.x += (dx / dist) * ent.speed * speedMult;
                ent.y += (dy / dist) * ent.speed * speedMult;
            }
        } else if (ent.job) {
            ent.job.progress += 0.5;
            if (ent.job.progress >= 100) {
                const tx = ent.job.x;
                const ty = ent.job.y;
                if (ent.job.type === 'build_wall') {
                    state.map.tiles[ty][tx].type = TILE_TYPES.WALL;
                } else if (ent.job.type === 'chop') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.BERRY_BUSH) {
                        state.resources.berries += 15;
                    } else {
                        state.resources.wood += 20;
                    }
                    state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                } else if (ent.job.type === 'mine') {
                    state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                    state.resources.stone += 20;
                } else if (ent.job.type === 'destruct') {
                    state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                }
                markTileDirty(tx, ty);
                state.jobs = state.jobs.filter(j => j !== ent.job);
                ent.job = null;
                ent.target = null;
                ent.path = [];
                updateResourceUI();
            }
        }
    });
}

function updateTimeUI() {
    const timeDisplay = document.getElementById('time');
    if (!timeDisplay) return;
    const h = String(state.time.hour).padStart(2, '0');
    const m = String(state.time.minute).padStart(2, '0');
    timeDisplay.innerText = `Day ${state.time.day}, ${h}:${m}`;
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.translate(state.camera.x, state.camera.y);

    const viewW = canvas.width / state.camera.zoom;
    const viewH = canvas.height / state.camera.zoom;
    const worldViewLeft = -state.camera.x - viewW / 2;
    const worldViewTop = -state.camera.y - viewH / 2;
    
    const chunkSizePx = state.map.chunkSize * state.map.tileSize;
    const startCX = Math.floor(worldViewLeft / chunkSizePx);
    const endCX = Math.ceil((worldViewLeft + viewW) / chunkSizePx);
    const startCY = Math.floor(worldViewTop / chunkSizePx);
    const endCY = Math.ceil((worldViewTop + viewH) / chunkSizePx);

    for (let cy = Math.max(0, startCY); cy < Math.min(state.map.chunks.length, endCY); cy++) {
        for (let cx = Math.max(0, startCX); cx < Math.min(state.map.chunks[cy].length, endCX); cx++) {
            const chunk = state.map.chunks[
