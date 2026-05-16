const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const state = {
    camera: {
        x: -1616,
        y: -1616,
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
        silver: 0,
        stone: 0,
        food: 10
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
    isPainting: false,
    selectedEntities: [],
    selectionBox: {
        active: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    },
    keys: {},
    keyPressTime: {}
};

const TILE_TYPES = {
    GRASS: { color: 'rgb(95, 94, 40)', name: 'Grass', moveCost: 1 },
    LIGHT_GRASS: { color: 'rgb(125, 124, 60)', name: 'Light Grass', moveCost: 1 },
    DARK_GRASS: { color: 'rgb(65, 64, 20)', name: 'Dark Grass', moveCost: 1.1 },
    SOIL: { color: '#5d4037', name: 'Soil', moveCost: 1.2 },
    WATER: { color: '#1976d2', name: 'Water', moveCost: 3 },
    DEEP_WATER: { color: '#0d47a1', name: 'Deep Water', solid: true },
    STONE: { color: '#757575', name: 'Stone', solid: true, harvestable: 'stone' },
    SAND: { color: '#c2b280', name: 'Sand', moveCost: 1.5 },
    WALL: { color: '#424242', name: 'Wall', solid: true }
};

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
    document.getElementById('silver-count').textContent = state.resources.silver;
    document.getElementById('stone-count').textContent = state.resources.stone;
    document.getElementById('food-count').textContent = state.resources.food;
}

function updateCharacterMenu() {
    const list = document.getElementById('character-list');
    if (!list) return;
    list.innerHTML = '';
    state.entities.forEach(ent => {
        const card = document.createElement('div');
        card.className = `character-card ${state.selectedEntities.includes(ent) ? 'selected' : ''}`;
        card.onclick = (e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) toggleEntitySelection(ent);
            else selectEntity(ent);
        };
        card.innerHTML = `<div class="character-avatar" style="background: ${ent.color}">👤</div><div class="character-name">${ent.name}</div>`;
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
            const continent = Noise.fbm(nx * 0.003, ny * 0.003, 3);
            const detail = Noise.fbm(nx * 0.02, ny * 0.02, 4);
            const elevation = (continent * 0.85 + detail * 0.15);
            const moisture = Noise.fbm(nx * 0.01 + 2000, ny * 0.01 + 2000, 3);
            let type;
            const sea_level = 0.42;
            if (elevation < sea_level) {
                if (elevation < sea_level - 0.15) type = TILE_TYPES.DEEP_WATER;
                else type = TILE_TYPES.WATER;
            } else {
                if (elevation < sea_level + 0.02) type = TILE_TYPES.SAND; 
                else if (elevation > 0.82) type = TILE_TYPES.STONE; 
                else {
                    if (moisture > 0.6) type = TILE_TYPES.LIGHT_GRASS;
                    else if (moisture > 0.44) type = TILE_TYPES.GRASS;
                    else if (moisture > 0.4) type = TILE_TYPES.DARK_GRASS;
                    else if (moisture > 0.37) type = TILE_TYPES.SOIL;
                    else type = TILE_TYPES.SAND; 
                }
            }
            const distFromCenter = Math.sqrt(Math.pow(x - state.map.width / 2, 2) + Math.pow(y - state.map.height / 2, 2));
            if (distFromCenter < 5) {
                if (type.solid || type === TILE_TYPES.WATER || type === TILE_TYPES.DEEP_WATER) type = TILE_TYPES.GRASS;
            }
            row.push({ type, x, y, elevation });
        }
        state.map.tiles.push(row);
    }
    const queue = [];
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            const tile = state.map.tiles[y][x];
            if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.DEEP_WATER) {
                let isShore = false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;
                        if (nx >= 0 && nx < state.map.width && ny >= 0 && ny < state.map.height) {
                            const neighbor = state.map.tiles[ny][nx];
                            if (neighbor.type !== TILE_TYPES.WATER && neighbor.type !== TILE_TYPES.DEEP_WATER) {
                                isShore = true;
                                break;
                            }
                        }
                    }
                    if (isShore) break;
                }
                if (isShore) { tile.shoreDist = 0; queue.push({x, y}); }
                else tile.shoreDist = Infinity;
            }
        }
    }
    let head = 0;
    while(head < queue.length) {
        const p = queue[head++];
        const currentDist = state.map.tiles[p.y][p.x].shoreDist;
        const dirs = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
        for (const d of dirs) {
            const nx = p.x + d.dx;
            const ny = p.y + d.dy;
            if (nx >= 0 && nx < state.map.width && ny >= 0 && ny < state.map.height) {
                const neighbor = state.map.tiles[ny][nx];
                if ((neighbor.type === TILE_TYPES.WATER || neighbor.type === TILE_TYPES.DEEP_WATER) && neighbor.shoreDist === Infinity) {
                    neighbor.shoreDist = currentDist + 1;
                    queue.push({x: nx, y: ny});
                }
            }
        }
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
            row.push({ cx, cy, canvas, ctx: canvas.getContext('2d'), dirty: true });
        }
        state.map.chunks.push(row);
    }
    state.map.chunks.forEach(row => row.forEach(c => c.dirty = true));
}

function getWaterColor(dist) {
    if (dist < 3) return '#29b6f6';
    if (dist < 8) {
        const t = (dist - 3) / 5;
        return interpolateColor('#29b6f6', '#0288d1', t);
    }
    if (dist < 20) {
        const t = (dist - 8) / 12;
        return interpolateColor('#0288d1', '#01579b', t);
    }
    const t = Math.min(1, (dist - 20) / 20);
    return interpolateColor('#01579b', '#002f6c', t);
}

function interpolateColor(c1, c2, t) {
    const hex = (c) => {
        if (c.startsWith('#')) {
            const r = parseInt(c.slice(1, 3), 16);
            const g = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            return [r, g, b];
        }
        const rgb = c.match(/\d+/g).map(Number);
        return rgb;
    };
    const rgb1 = hex(c1);
    const rgb2 = hex(c2);
    const r = Math.round(rgb1[0] + (rgb2[0] - rgb1[0]) * t);
    const g = Math.round(rgb1[1] + (rgb2[1] - rgb1[1]) * t);
    const b = Math.round(rgb1[2] + (rgb2[2] - rgb1[2]) * t);
    return `rgb(${r},${g},${b})`;
}

function updateChunk(chunk) {
    const ctx = chunk.ctx;
    const size = state.map.chunkSize;
    const ts = state.map.tileSize;
    
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = size + 2;
    bgCanvas.height = size + 2;
    const bgCtx = bgCanvas.getContext('2d');
    
    for (let ly = -1; ly <= size; ly++) {
        for (let lx = -1; lx <= size; lx++) {
            const gy = chunk.cy * size + ly;
            const gx = chunk.cx * size + lx;
            
            let color = '#002f6c';
            if (gy >= 0 && gy < state.map.height && gx >= 0 && gx < state.map.width) {
                const tile = state.map.tiles[gy][gx];
                if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.DEEP_WATER) {
                    color = getWaterColor(tile.shoreDist || 0);
                } else {
                    color = tile.type.color;
                }
            }
            bgCtx.fillStyle = color;
            bgCtx.fillRect(lx + 1, ly + 1, 1, 1);
        }
    }
    
    ctx.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bgCanvas, 1, 1, size, size, 0, 0, size * ts, size * ts);

    for (let ly = 0; ly < size; ly++) {
        for (let lx = 0; lx < size; lx++) {
            const gy = chunk.cy * size + ly;
            const gx = chunk.cx * size + lx;
            if (gy < state.map.height && gx < state.map.width) {
                const tile = state.map.tiles[gy][gx];
                if (tile.type === TILE_TYPES.GRASS || tile.type === TILE_TYPES.LIGHT_GRASS || tile.type === TILE_TYPES.DARK_GRASS) {
                    ctx.lineWidth = 1; ctx.lineCap = 'round';
                    const grassColor = tile.type === TILE_TYPES.LIGHT_GRASS ? 'rgba(190, 240, 130,' : (tile.type === TILE_TYPES.DARK_GRASS ? 'rgba(120, 160, 80,' : 'rgba(160, 210, 100,');
                    for (let i = 0; i < 6; i++) {
                        const ox = (gx * 13 + i * 9) % (ts - 6) + 3;
                        const oy = (gy * 17 + i * 13) % (ts - 6) + 6;
                        const h = 4 + (gx + gy + i) % 5;
                        const angle = ((gx + gy + i) % 10 - 5) * 0.1;
                        ctx.strokeStyle = `${grassColor} ${0.4 + (i % 3) * 0.1})`;
                        ctx.beginPath(); ctx.moveTo(lx * ts + ox, ly * ts + oy); ctx.lineTo(lx * ts + ox + angle * h, ly * ts + oy - h); ctx.stroke();
                        if (i % 2 === 0) { ctx.beginPath(); ctx.moveTo(lx * ts + ox + 2, ly * ts + oy); ctx.lineTo(lx * ts + ox + 2 + angle * (h-1), ly * ts + oy - h + 1); ctx.stroke(); }
                    }
                } else if (tile.type === TILE_TYPES.SOIL) {
                    for (let i = 0; i < 5; i++) {
                        const ox = (gx * 23 + i * 13) % (ts - 6) + 3;
                        const oy = (gy * 29 + i * 19) % (ts - 6) + 3;
                        const s = 1 + (gx + gy + i) % 2;
                        const gray = 100 + (gx * i) % 50;
                        ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, 0.6)`;
                        ctx.beginPath(); ctx.arc(lx * ts + ox, ly * ts + oy, s, 0, Math.PI * 2); ctx.fill();
                    }
                } else if (tile.type === TILE_TYPES.STONE) {
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
                    for (let i = 0; i < 3; i++) {
                        const ox = (gx * 37 + i * 11) % (ts - 8) + 4;
                        const oy = (gy * 41 + i * 13) % (ts - 8) + 4;
                        ctx.beginPath(); ctx.moveTo(lx * ts + ox, ly * ts + oy); ctx.lineTo(lx * ts + ox + 4, ly * ts + oy + 2); ctx.stroke();
                    }
                } else if (tile.type === TILE_TYPES.WALL) {
                    ctx.fillStyle = tile.type.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.strokeRect(lx * ts + 1, ly * ts + 1, ts - 2, ts - 2);
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                    ctx.strokeRect(lx * ts, ly * ts, ts, ts);
                }
            }
        }
    }
    chunk.dirty = false;
}

function markTileDirty(tx, ty) {
    const cx = Math.floor(tx / state.map.chunkSize);
    const cy = Math.floor(ty / state.map.chunkSize);
    if (state.map.chunks[cy] && state.map.chunks[cy][cx]) state.map.chunks[cy][cx].dirty = true;
}

function drawFogOfWar() {
    const ts = state.map.tileSize;
    const visionRadiusPx = state.map.visionRadius * ts * 1.2; 
    const currentTime = state.time.hour + state.time.minute / 60;
    let fogIntensity = 1.0; 
    if (currentTime >= 4 && currentTime < 9) fogIntensity = 1.0 * (1 - (currentTime - 4) / 5);
    else if (currentTime >= 9 && currentTime < 15) fogIntensity = 0;
    else if (currentTime >= 15 && currentTime < 21) fogIntensity = 1.0 * (currentTime - 15) / 6;
    else fogIntensity = 1.0;
    if (fogIntensity <= 0) return;
    if (!state.fowCanvas) {
        state.fowCanvas = document.createElement('canvas');
        state.fowCtx = state.fowCanvas.getContext('2d', { alpha: true });
    }
    if (state.fowCanvas.width !== canvas.width || state.fowCanvas.height !== canvas.height) {
        state.fowCanvas.width = canvas.width;
        state.fowCanvas.height = canvas.height;
    }
    const fCtx = state.fowCtx;
    fCtx.imageSmoothingEnabled = true;
    fCtx.globalCompositeOperation = 'source-over';
    fCtx.clearRect(0, 0, canvas.width, canvas.height);
    fCtx.fillStyle = `rgba(0, 0, 0, ${fogIntensity})`;
    fCtx.fillRect(0, 0, canvas.width, canvas.height);
    fCtx.globalCompositeOperation = 'destination-out';
    const camX = Math.floor(state.camera.x);
    const camY = Math.floor(state.camera.y);
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    state.entities.forEach(ent => {
        const screenX = Math.floor(ent.x * ts + camX) * state.camera.zoom + centerX;
        const screenY = Math.floor(ent.y * ts + camY) * state.camera.zoom + centerY;
        const zoomRadius = Math.floor(visionRadiusPx * state.camera.zoom);
        const grad = fCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, zoomRadius);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.4, 'rgba(255, 255, 255, 1)'); 
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        fCtx.fillStyle = grad;
        fCtx.beginPath(); fCtx.arc(screenX, screenY, zoomRadius, 0, Math.PI * 2); fCtx.fill();
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(state.fowCanvas, 0, 0);
    ctx.restore();
}

function isWalkable(tx, ty) {
    if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) return false;
    const tile = state.map.tiles[ty][tx];
    if (tile.type.solid) return false;
    if (tile.type === TILE_TYPES.WATER) {
        const neighbors = [{x: tx-1, y: ty}, {x: tx+1, y: ty}, {x: tx, y: ty-1}, {x: tx, y: ty+1}];
        return neighbors.some(n => {
            if (n.x < 0 || n.x >= state.map.width || n.y < 0 || n.y >= state.map.height) return false;
            const neighborTile = state.map.tiles[n.y][n.x];
            return neighborTile.type !== TILE_TYPES.WATER && neighborTile.type !== TILE_TYPES.DEEP_WATER;
        });
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
        if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.DEEP_WATER || tile.type.solid) return false;
    }
    return true;
}

function initEntities() {
    state.entities.push({
        id: 1, name: 'Makcum', x: 50.5, y: 50.5, color: '#ffcc80', target: null, job: null,
        speed: 0.1, needs: { food: 100, rest: 100 }, path: [], currentSpeedModifier: 1.0, statusMessages: []
    });
    state.entities.push({
        id: 2, name: 'Arcen', x: 51.5, y: 50.5, color: '#f48fb1', target: null, job: null,
        speed: 0.12, needs: { food: 100, rest: 100 }, path: [], currentSpeedModifier: 1.0, statusMessages: []
    });
    state.entities.push({
        id: 3, name: "Admin", x: 50.5, y: 51.5, color: '#90caf9', target: null, job: null,
        speed: 0.08, needs: { food: 100, rest: 100 }, path: [], currentSpeedModifier: 1.0, statusMessages: []
    });
    updateCharacterMenu();
}

function findPath(startX, startY, endX, endY) {
    startX = Math.floor(startX); startY = Math.floor(startY);
    endX = Math.floor(endX); endY = Math.floor(endY);
    if (endX < 0 || endX >= state.map.width || endY < 0 || endY >= state.map.height) return null;
    const openSet = [{ x: startX, y: startY, g: 0, h: dist(startX, startY, endX, endY), f: 0, parent: null }];
    const closedSet = new Set();
    function dist(x1, y1, x2, y2) { return Math.abs(x1 - x2) + Math.abs(y1 - y2); }
    const maxIterations = 1000;
    let iterations = 0;
    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        let currentIdx = 0;
        for (let i = 1; i < openSet.length; i++) { if (openSet[i].f < openSet[currentIdx].f) currentIdx = i; }
        const current = openSet.splice(currentIdx, 1)[0];
        if (current.x === endX && current.y === endY) {
            const path = [];
            let temp = current;
            while (temp) { path.push({ x: temp.x + 0.5, y: temp.y + 0.5 }); temp = temp.parent; }
            return path.reverse();
        }
        closedSet.add(`${current.x},${current.y}`);
        const neighbors = [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }];
        for (const neighbor of neighbors) {
            if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;
            const isDest = neighbor.x === endX && neighbor.y === endY;
            if (!isWalkable(neighbor.x, neighbor.y) && !isDest) continue;
            const cost = state.map.tiles[neighbor.y][neighbor.x].type.moveCost || 1;
            const gScore = current.g + cost;
            let neighborNode = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
            if (!neighborNode) {
                neighborNode = { x: neighbor.x, y: neighbor.y, g: gScore, h: dist(neighbor.x, neighbor.y, endX, endY), f: 0, parent: current };
                neighborNode.f = neighborNode.g + neighborNode.h;
                openSet.push(neighborNode);
            } else if (gScore < neighborNode.g) {
                neighborNode.g = gScore; neighborNode.f = neighborNode.g + neighborNode.h; neighborNode.parent = current;
            }
        }
    }
    return null;
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function tryPlaceJob(mouseX, mouseY) {
    if (!state.currentOrder) return;
    const worldPos = screenToWorld(mouseX, mouseY);
    const tx = Math.floor(worldPos.x / state.map.tileSize);
    const ty = Math.floor(worldPos.y / state.map.tileSize);
    if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
        const existingJob = state.jobs.find(j => j.x === tx && j.y === ty);
        if (!existingJob) {
            let job = null;
            if (state.currentOrder === 'architect' && state.map.tiles[ty][tx].type !== TILE_TYPES.WALL) job = { type: 'build_wall', x: tx, y: ty, progress: 0, assigned: false };
            else if (state.currentOrder === 'mine' && state.map.tiles[ty][tx].type === TILE_TYPES.STONE) job = { type: 'mine', x: tx, y: ty, progress: 0, assigned: false };
            else if (state.currentOrder === 'unarchitect' && state.map.tiles[ty][tx].type === TILE_TYPES.WALL) job = { type: 'destruct', x: tx, y: ty, progress: 0, assigned: false };
            if (job) { state.jobs.push(job); state.selectedEntities.forEach(ent => assignJobToEntity(ent, job)); }
        }
    }
}

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('#top-bar') || e.target.closest('#bottom-menu') || e.target.closest('#inspect-panel') || e.target.closest('#character-menu') || e.target.closest('#regen-btn')) return;
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        state.camera.isDragging = true;
        state.camera.lastMouseX = e.clientX; state.camera.lastMouseY = e.clientY;
        state.camera.dragStartX = e.clientX; state.camera.dragStartY = e.clientY;
        return;
    }
    if (e.button === 0) {
        if (state.currentOrder) {
            state.isPainting = true;
            tryPlaceJob(e.clientX, e.clientY);
        } else {
            const worldPos = screenToWorld(e.clientX, e.clientY);
            const clickedEnt = state.entities.find(ent => {
                const dx = ent.x - (worldPos.x / state.map.tileSize);
                const dy = ent.y - (worldPos.y / state.map.tileSize);
                return Math.sqrt(dx * dx + dy * dy) < 0.6;
            });
            if (clickedEnt) {
                if (e.ctrlKey || e.metaKey) toggleEntitySelection(clickedEnt);
                else selectEntity(clickedEnt);
            } else {
                state.selectionBox.active = true;
                state.selectionBox.startX = e.clientX; state.selectionBox.startY = e.clientY;
                state.selectionBox.endX = e.clientX; state.selectionBox.endY = e.clientY;
            }
        }
    } else if (e.button === 2) {
        if (state.selectedEntities.length > 0) {
            const worldPos = screenToWorld(e.clientX, e.clientY);
            const tx = Math.floor(worldPos.x / state.map.tileSize);
            const ty = Math.floor(worldPos.y / state.map.tileSize);
            if (isWalkable(tx, ty)) {
                state.selectedEntities.forEach(ent => {
                    if (isPathClearOfWater(ent.x, ent.y, tx, ty)) {
                        ent.path = [{ x: tx + 0.5, y: ty + 0.5 }]; ent.target = ent.path[0]; ent.job = null; ent.isManualMove = true;
                    } else {
                        const path = findPath(ent.x, ent.y, tx, ty);
                        if (path) { ent.path = path; ent.target = path[0]; ent.isManualMove = true; ent.job = null; }
                    }
                });
            }
        }
    }
});

function selectEntity(ent) {
    state.selectedEntities = [ent]; ent.isManualMove = false; updateInspectPanel(ent); updateCharacterMenu();
}

function deselectEntity() {
    state.selectedEntities = []; document.getElementById('inspect-panel').classList.add('hidden'); updateCharacterMenu();
}

function toggleEntitySelection(ent) {
    const index = state.selectedEntities.indexOf(ent);
    if (index > -1) state.selectedEntities.splice(index, 1);
    else state.selectedEntities.push(ent);
    if (state.selectedEntities.length > 0) updateInspectPanel(state.selectedEntities[0]);
    else document.getElementById('inspect-panel').classList.add('hidden');
    updateCharacterMenu();
}

function selectEntitiesInBox() {
    const minX = Math.min(state.selectionBox.startX, state.selectionBox.endX);
    const minY = Math.min(state.selectionBox.startY, state.selectionBox.endY);
    const maxX = Math.max(state.selectionBox.startX, state.selectionBox.endX);
    const maxY = Math.max(state.selectionBox.startY, state.selectionBox.endY);
    state.selectedEntities = [];
    state.entities.forEach(ent => {
        const screenPos = worldToScreen(ent.x * state.map.tileSize, ent.y * state.map.tileSize);
        if (screenPos.x >= minX && screenPos.x <= maxX && screenPos.y >= minY && screenPos.y <= maxY) state.selectedEntities.push(ent);
    });
    if (state.selectedEntities.length > 0) updateInspectPanel(state.selectedEntities[0]);
    else document.getElementById('inspect-panel').classList.add('hidden');
    updateCharacterMenu();
}

function selectAllEntities() {
    if (state.selectedEntities.length === state.entities.length) deselectEntity();
    else {
        state.selectedEntities = [...state.entities];
        if (state.selectedEntities.length > 0) updateInspectPanel(state.selectedEntities[0]);
        updateCharacterMenu();
    }
}

function worldToScreen(worldX, worldY) {
    const screenX = (worldX + state.camera.x) * state.camera.zoom + canvas.width / 2;
    const screenY = (worldY + state.camera.y) * state.camera.zoom + canvas.height / 2;
    return { x: screenX, y: screenY };
}

function updateInspectPanel(ent) {
    const panel = document.getElementById('inspect-panel');
    const title = document.getElementById('inspect-title');
    const content = document.getElementById('inspect-content');
    panel.classList.remove('hidden');
    title.innerText = ent.name;
    let statusText = ent.job ? 'Working' : (ent.target ? 'Moving' : 'Idle');
    if (ent.status === 'eating') statusText = 'Eating';
    if (ent.status === 'sleeping') statusText = 'Sleeping';
    content.innerHTML = `
        <p>Status: ${statusText}</p>
        <p>Food: ${Math.floor(ent.needs.food)}%</p>
        <p>Rest: ${Math.floor(ent.needs.rest)}%</p>
        <div class="inspect-actions">
            <button onclick="orderEat()" ${state.resources.food <= 0 || ent.needs.food >= 100 || ent.status ? 'disabled' : ''}>Eat (1 Food)</button>
            <button onclick="orderSleep()" ${ent.needs.rest >= 100 || ent.status ? 'disabled' : ''}>Sleep</button>
        </div>
        <p style="color: #81d4fa; font-size: 0.8em;">(Right-click to move)</p>
    `;
}

window.orderEat = function() {
    if (state.selectedEntities.length === 0 || state.resources.food <= 0) return;
    const ent = state.selectedEntities[0];
    if (ent.needs.food < 100) {
        state.resources.food--; updateResourceUI();
        ent.status = 'eating'; ent.job = null; ent.target = null; ent.path = [];
        updateInspectPanel(ent);
    }
};

window.orderSleep = function() {
    if (state.selectedEntities.length === 0) return;
    const ent = state.selectedEntities[0];
    if (ent.needs.rest < 100) {
        ent.status = 'sleeping'; ent.job = null; ent.target = null; ent.path = [];
        updateInspectPanel(ent);
    }
};

function screenToWorld(screenX, screenY) {
    const x = (screenX - canvas.width / 2) / state.camera.zoom - state.camera.x;
    const y = (screenY - canvas.height / 2) / state.camera.zoom - state.camera.y;
    return { x, y };
}

window.addEventListener('keydown', (e) => {
    state.keys[e.code] = true;
    if (!state.keyPressTime[e.code]) state.keyPressTime[e.code] = Date.now();
    if (e.code === 'Space') { e.preventDefault(); deselectEntity(); }
    else if (e.code === 'KeyL') toggleFogOfWar();
    else if (e.code === 'KeyH') toggleUI();
    else if (e.code === 'KeyP') toggleDebugTime();
    else if (e.code === 'KeyZ') setOrder('architect');
    else if (e.code === 'KeyX') setOrder('unarchitect');
    else if (e.code === 'KeyC') setOrder('chop');
    else if (e.code === 'KeyT') selectAllEntities();
});

window.addEventListener('keyup', (e) => {
    state.keys[e.code] = false;
    if (e.code === 'KeyR' && state.keyPressTime[e.code]) {
        if (Date.now() - state.keyPressTime[e.code] >= 2000) regenerateWorld();
        delete state.keyPressTime[e.code];
    }
});

function toggleDebugTime() {
    const panel = document.getElementById('debug-time-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
        const slider = document.getElementById('time-slider');
        slider.value = state.time.hour * 60 + state.time.minute;
        updateSliderDisplay();
    }
}

function updateSliderDisplay() {
    const slider = document.getElementById('time-slider');
    const display = document.getElementById('slider-time-display');
    const totalMinutes = parseInt(slider.value);
    const h = Math.floor(totalMinutes / 60); const m = totalMinutes % 60;
    display.innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('time-slider');
    if (slider) {
        slider.addEventListener('input', () => {
            const totalMinutes = parseInt(slider.value);
            state.time.hour = Math.floor(totalMinutes / 60); state.time.minute = totalMinutes % 60;
            updateSliderDisplay(); updateTimeUI();
        });
    }
});

function toggleUI() { document.getElementById('ui-overlay').classList.toggle('ui-hidden'); }

function toggleFogOfWar() {
    state.map.fogOfWarEnabled = !state.map.fogOfWarEnabled;
    state.map.chunks.forEach(row => row.forEach(c => c.dirty = true));
}

window.addEventListener('mousemove', (e) => {
    if (state.camera.isDragging) {
        state.camera.x += (e.clientX - state.camera.lastMouseX) / state.camera.zoom;
        state.camera.y += (e.clientY - state.camera.lastMouseY) / state.camera.zoom;
    }
    if (state.selectionBox.active) { state.selectionBox.endX = e.clientX; state.selectionBox.endY = e.clientY; }
    if (state.isPainting) { tryPlaceJob(e.clientX, e.clientY); }
    state.camera.lastMouseX = e.clientX; state.camera.lastMouseY = e.clientY;
});

window.addEventListener('mouseup', (e) => {
    if (state.selectionBox.active && e.button === 0) {
        state.selectionBox.endX = e.clientX; state.selectionBox.endY = e.clientY;
        if (Math.abs(state.selectionBox.endX - state.selectionBox.startX) > 5 || Math.abs(state.selectionBox.endY - state.selectionBox.startY) > 5) selectEntitiesInBox();
        state.selectionBox.active = false;
    }
    state.isPainting = false;
    state.camera.isDragging = false;
});

window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = state.camera.zoom;
    const newZoom = Math.max(0.1, Math.min(5, state.camera.zoom * factor));
    if (newZoom !== oldZoom) {
        const mouseWorldBefore = screenToWorld(e.clientX, e.clientY);
        state.camera.zoom = newZoom;
        const mouseWorldAfter = screenToWorld(e.clientX, e.clientY);
        state.camera.x += (mouseWorldAfter.x - mouseWorldBefore.x);
        state.camera.y += (mouseWorldAfter.y - mouseWorldBefore.y);
    }
}, { passive: false });

function assignJobToEntity(ent, job) {
    if (ent.job) ent.job.assigned = false;
    ent.job = job; job.assigned = true;
    if (isPathClearOfWater(ent.x, ent.y, job.x, job.y)) { ent.path = [{ x: job.x + 0.5, y: job.y + 0.5 }]; ent.target = ent.path[0]; }
    else { const path = findPath(ent.x, ent.y, job.x, job.y); if (path) { ent.path = path; ent.target = path[0]; } }
}

function update() {
    const camSpeed = 10 / state.camera.zoom;
    if (state.keys['KeyW']) state.camera.y += camSpeed;
    if (state.keys['KeyS']) state.camera.y -= camSpeed;
    if (state.keys['KeyA']) state.camera.x += camSpeed;
    if (state.keys['KeyD']) state.camera.x -= camSpeed;

    const regenProgress = document.getElementById('regen-progress');
    if (state.keys['KeyR'] && state.keyPressTime['KeyR']) {
        const elapsed = Date.now() - state.keyPressTime['KeyR'];
        const percent = Math.min(100, (elapsed / 2000) * 100);
        if (regenProgress) regenProgress.style.width = percent + '%';
    } else {
        if (regenProgress) regenProgress.style.width = '0%';
    }

    state.time.tick++;
    if (state.time.tick % 60 === 0) {
        state.time.minute++;
        if (state.time.minute >= 60) {
            state.time.minute = 0; state.time.hour++;
            if (state.time.hour >= 24) { state.time.hour = 0; state.time.day++; }
        }
        updateTimeUI();
    }
    state.entities.forEach(ent => {
        if (ent.status !== 'sleeping') {
            ent.needs.food = Math.max(0, ent.needs.food - 0.002);
            ent.needs.rest = Math.max(0, ent.needs.rest - 0.0015);
        } else {
            ent.needs.rest = Math.min(100, ent.needs.rest + 0.05);
            if (ent.needs.rest >= 100) ent.status = null;
        }
        if (ent.status === 'eating') {
            ent.needs.food = Math.min(100, ent.needs.food + 0.5);
            if (ent.needs.food >= 100) ent.status = null;
        }
        if (ent.status === 'sleeping' || ent.status === 'eating') {
            if (state.selectedEntities.includes(ent)) updateInspectPanel(ent);
            return;
        }
        if (!ent.job && !ent.target && (!ent.waypointQueue || ent.waypointQueue.length === 0)) {
            const availableJob = state.jobs.find(j => !j.assigned);
            if (availableJob) assignJobToEntity(ent, availableJob);
        }
        if (ent.target) {
            const dx = ent.target.x - ent.x; const dy = ent.target.y - ent.y; const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.1) {
                ent.x = ent.target.x; ent.y = ent.target.y;
                if (ent.path && ent.path.length > 0) {
                    ent.path.shift();
                    if (ent.path.length > 0) ent.target = ent.path[0];
                    else { ent.target = null; ent.isManualMove = false; }
                } else {
                    ent.target = null; ent.isManualMove = false;
                    if (ent.waypointQueue && ent.waypointQueue.length > 0) {
                        const nextWP = ent.waypointQueue.shift();
                        const path = findPath(ent.x, ent.y, Math.floor(nextWP.x), Math.floor(nextWP.y));
                        if (path) { ent.path = path; ent.target = ent.path[0]; ent.isManualMove = true; }
                    }
                }
            } else {
                const tx = Math.floor(ent.x); const ty = Math.floor(ent.y);
                let speedMult = 1;
                if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) speedMult = 1 / (state.map.tiles[ty][tx].type.moveCost || 1);
                if (ent.needs.food < 20) speedMult *= 0.5;
                if (ent.needs.rest < 20) speedMult *= 0.5;
                if (ent.needs.rest <= 0) { ent.status = 'sleeping'; ent.job = null; ent.target = null; ent.path = []; }
                ent.x += (dx / dist) * ent.speed * speedMult; ent.y += (dy / dist) * ent.speed * speedMult;
            }
        } else if (ent.job) {
            const dx = (ent.job.x + 0.5) - ent.x; const dy = (ent.job.y + 0.5) - ent.y;
            if (Math.sqrt(dx * dx + dy * dy) < 0.2) {
                ent.job.progress += 0.5; 
                if (ent.job.progress >= 100) {
                    const job = ent.job; const tx = job.x; const ty = job.y;
                    if (job.type === 'build_wall') state.map.tiles[ty][tx].type = TILE_TYPES.WALL;
                    else if (job.type === 'mine') { state.map.tiles[ty][tx].type = TILE_TYPES.GRASS; state.resources.stone += 20; updateResourceUI(); }
                    else if (job.type === 'destruct') state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                    state.map.chunks[Math.floor(ty / state.map.chunkSize)][Math.floor(tx / state.map.chunkSize)].dirty = true;
                    state.jobs = state.jobs.filter(j => j !== job); ent.job = null;
                }
            } else if (!ent.target) assignJobToEntity(ent, ent.job);
        } else if (Math.random() < 0.01) {
            const tx = Math.floor(ent.x + (Math.random() * 10 - 5)); const ty = Math.floor(ent.y + (Math.random() * 10 - 5));
            if (isWalkable(tx, ty)) {
                if (isPathClearOfWater(ent.x, ent.y, tx, ty)) { ent.path = [{ x: tx + 0.5, y: ty + 0.5 }]; ent.target = ent.path[0]; }
                else { const path = findPath(ent.x, ent.y, tx, ty); if (path) { ent.path = path; ent.target = path[0]; } }
            }
        }
    });
}

function updateTimeUI() {
    const timeDisplay = document.getElementById('time');
    if (!timeDisplay) return;
    timeDisplay.innerText = `Day ${state.time.day}, ${String(state.time.hour).padStart(2, '0')}:${String(state.time.minute).padStart(2, '0')}`;
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
            const chunk = state.map.chunks[cy][cx];
            if (chunk.dirty) updateChunk(chunk);
            ctx.drawImage(chunk.canvas, cx * chunkSizePx, cy * chunkSizePx);
        }
    }
    if (state.camera.zoom > 0.5) {
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 1 / state.camera.zoom;
        ctx.beginPath();
        const startTX = Math.floor(worldViewLeft / state.map.tileSize);
        const endTX = Math.ceil((worldViewLeft + viewW) / state.map.tileSize);
        const startTY = Math.floor(worldViewTop / state.map.tileSize);
        const endTY = Math.ceil((worldViewTop + viewH) / state.map.tileSize);
        for (let x = Math.max(0, startTX); x <= Math.min(state.map.width, endTX); x++) {
            ctx.moveTo(x * state.map.tileSize, Math.max(0, startTY) * state.map.tileSize);
            ctx.lineTo(x * state.map.tileSize, Math.min(state.map.height, endTY) * state.map.tileSize);
        }
        for (let y = Math.max(0, startTY); y <= Math.min(state.map.height, endTY); y++) {
            ctx.moveTo(Math.max(0, startTX) * state.map.tileSize, y * state.map.tileSize);
            ctx.lineTo(Math.min(state.map.width, endTX) * state.map.tileSize, y * state.map.tileSize);
        }
        ctx.stroke();
    }
    if (state.currentOrder === 'architect' || state.currentOrder === 'unarchitect') {
        const mouseWorld = screenToWorld(state.camera.lastMouseX, state.camera.lastMouseY);
        const tx = Math.floor(mouseWorld.x / state.map.tileSize);
        const ty = Math.floor(mouseWorld.y / state.map.tileSize);
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            ctx.fillStyle = state.currentOrder === 'architect' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 0, 0, 0.3)';
            ctx.fillRect(tx * state.map.tileSize, ty * state.map.tileSize, state.map.tileSize, state.map.tileSize);
        }
    }
    drawFogOfWar();
    state.jobs.forEach(job => {
        ctx.setLineDash(job.type === 'build_wall' ? [5, 5] : [2, 2]);
        ctx.strokeStyle = job.type === 'build_wall' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 0, 0, 0.5)';
        ctx.strokeRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + 2, state.map.tileSize - 4, state.map.tileSize - 4);
        ctx.setLineDash([]);
        if (job.progress > 0) {
            ctx.fillStyle = job.type === 'build_wall' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 0, 0, 0.3)';
            const h = (state.map.tileSize - 4) * (job.progress / 100);
            ctx.fillRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + state.map.tileSize - 2 - h, state.map.tileSize - 4, h);
        }
    });
    state.entities.forEach(ent => {
        if (state.selectedEntities.includes(ent)) {
            ctx.strokeStyle = '#81d4fa';
            ctx.lineWidth = 2 / state.camera.zoom;
            ctx.beginPath();
            ctx.arc(ent.x * state.map.tileSize, ent.y * state.map.tileSize, state.map.tileSize / 2, 0, Math.PI * 2);
            ctx.stroke();
            if (ent.path && ent.path.length > 0) {
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = 2 / state.camera.zoom;
                ctx.setLineDash([5, 5]);
                ctx.moveTo(ent.x * state.map.tileSize, ent.y * state.map.tileSize);
                ent.path.forEach(point => ctx.lineTo(point.x * state.map.tileSize, point.y * state.map.tileSize));
                ctx.stroke();
                ctx.setLineDash([]);
                const lastPoint = ent.path[ent.path.length - 1];
                ctx.beginPath();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.arc(lastPoint.x * state.map.tileSize, lastPoint.y * state.map.tileSize, state.map.tileSize / 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }
        ctx.fillStyle = ent.color;
        ctx.beginPath();
        ctx.arc(ent.x * state.map.tileSize, ent.y * state.map.tileSize, state.map.tileSize / 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        let displayName = ent.name;
        if (ent.status === 'eating') displayName += ' 🍎';
        if (ent.status === 'sleeping') displayName += ' 💤';
        ctx.fillText(displayName, ent.x * state.map.tileSize, ent.y * state.map.tileSize - 15);
    });
    ctx.restore();
    if (state.selectionBox.active) {
        const minX = Math.min(state.selectionBox.startX, state.selectionBox.endX);
        const minY = Math.min(state.selectionBox.startY, state.selectionBox.endY);
        const width = Math.abs(state.selectionBox.endX - state.selectionBox.startX);
        const height = Math.abs(state.selectionBox.endY - state.selectionBox.startY);
        ctx.strokeStyle = '#81d4fa';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(minX, minY, width, height);
        ctx.fillStyle = 'rgba(129, 212, 250, 0.1)';
        ctx.fillRect(minX, minY, width, height);
        ctx.setLineDash([]);
    }
    update();
    requestAnimationFrame(render);
}
window.regenerateWorld = function() {
    initMap();
    let baseSpawnX = state.map.width / 2; let baseSpawnY = state.map.height / 2;
    const landTiles = [];
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            const tile = state.map.tiles[y][x];
            if (!tile.type.solid && tile.type !== TILE_TYPES.WATER && tile.type !== TILE_TYPES.DEEP_WATER) landTiles.push({x, y});
        }
    }
    if (landTiles.length > 0) {
        const randomBase = landTiles[Math.floor(Math.random() * landTiles.length)];
        baseSpawnX = randomBase.x; baseSpawnY = randomBase.y;
    }
    state.entities.forEach(ent => {
        let spawnX = baseSpawnX; let spawnY = baseSpawnY;
        const nearbyLand = landTiles.filter(t => Math.abs(t.x - baseSpawnX) <= 5 && Math.abs(t.y - baseSpawnY) <= 5);
        if (nearbyLand.length > 0) { const randomTile = nearbyLand[Math.floor(Math.random() * nearbyLand.length)]; spawnX = randomTile.x; spawnY = randomTile.y; }
        ent.x = spawnX + 0.5; ent.y = spawnY + 0.5; ent.target = null; ent.job = null; ent.path = [];
    });
    state.jobs = [];
    state.camera.x = -(baseSpawnX * state.map.tileSize); state.camera.y = -(baseSpawnY * state.map.tileSize);
    updateCharacterMenu();
};
window.setOrder = function(type) {
    if (state.currentOrder === type) state.currentOrder = null;
    else state.currentOrder = type;
    const orderNames = { 'architect': 'Architect', 'unarchitect': 'Destruct', 'chop': 'Chop', 'mine': 'Mine', 'work': 'Work' };
    const buttons = document.querySelectorAll('#bottom-menu button');
    buttons.forEach(btn => {
        if (orderNames[type] === btn.innerText) btn.style.background = state.currentOrder === type ? '#555' : '#333';
        else btn.style.background = '#333';
    });
};
window.addEventListener('resize', resize);
resize(); initMap(); initEntities(); updateResourceUI(); requestAnimationFrame(render);
