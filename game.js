// RimWorld Clone - Core Game Engine

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game State
const state = {
    camera: {
        x: -8000, // Center on 250,250
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
        chunkSize: 16, // 16x16 tiles per chunk
        explored: null, // Will be Uint8Array
        visionRadius: 20
    },
    
    resources: {
        wood: 0,
        stone: 0
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
    FOREST: { color: '#2d5a27', name: 'Forest', moveCost: 2 },
    SOIL: { color: '#5d4037', name: 'Soil', moveCost: 1.2 },
    WATER: { color: '#1976d2', name: 'Water', moveCost: 3 },
    DEEP_WATER: { color: '#0d47a1', name: 'Deep Water', solid: true },
    STONE: { color: '#757575', name: 'Stone', solid: true, harvestable: 'stone' },
    SAND: { color: '#c2b280', name: 'Sand', moveCost: 1.5 },
    TREE: { color: '#1b5e20', name: 'Tree', solid: true, harvestable: 'wood' },
    WALL: { color: '#424242', name: 'Wall', solid: true }
};

// --- Simple Noise Generator (Perlin-like) ---
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
    // FBM (Fractal Brownian Motion) for more detail
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
        return (total / maxValue + 1) / 2; // Normalize to 0-1
    }
};
Noise.init();

function updateResourceUI() {
    document.getElementById('wood-count').textContent = state.resources.wood;
    document.getElementById('stone-count').textContent = state.resources.stone;
}

// Initialize Map
function initMap() {
    state.map.tiles = [];
    state.map.explored = new Uint8Array(state.map.width * state.map.height);
    const seedX = Math.random() * 1000;
    const seedY = Math.random() * 1000;
    const moistureSeedX = Math.random() * 1000;
    const moistureSeedY = Math.random() * 1000;

    for (let y = 0; y < state.map.height; y++) {
        const row = [];
        for (let x = 0; x < state.map.width; x++) {
            // Elevation noise (determines land vs water vs mountain)
            const elevation = Noise.fbm((x + seedX) * 0.02, (y + seedY) * 0.02, 6);
            // Moisture noise (determines forest vs desert)
            const moisture = Noise.fbm((x + moistureSeedX) * 0.03, (y + moistureSeedY) * 0.03, 4);
            
            let type = TILE_TYPES.GRASS;
            
            // Terrain Rules
            if (elevation < 0.25) {
                type = TILE_TYPES.DEEP_WATER;
            } else if (elevation < 0.35) {
                type = TILE_TYPES.WATER;
            } else if (elevation < 0.38) {
                type = TILE_TYPES.SAND;
            } else if (elevation > 0.75) { // Lowered threshold for stone (0.8 -> 0.75)
                type = TILE_TYPES.STONE;
            } else {
                // Biome Rules based on moisture
                if (moisture > 0.7) { // Lowered threshold for forest (0.75 -> 0.7)
                    // High moisture - forest or trees
                    if (Math.random() < 0.2) type = TILE_TYPES.TREE; // Increased tree chance (0.15 -> 0.2)
                    else type = TILE_TYPES.FOREST;
                }
                else if (moisture > 0.5) type = TILE_TYPES.GRASS;
                else if (moisture > 0.3) type = TILE_TYPES.SOIL;
                else type = TILE_TYPES.SAND; // Desert
            }
            
            // Guarantee safe start area (center)
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

    // Initialize Chunks
    state.map.chunks = [];
    const chunksX = Math.ceil(state.map.width / state.map.chunkSize);
    const chunksY = Math.ceil(state.map.height / state.map.chunkSize);

    // Count resources for debugging
    let treeCount = 0;
    let stoneCount = 0;
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            if (state.map.tiles[y][x].type === TILE_TYPES.TREE) treeCount++;
            if (state.map.tiles[y][x].type === TILE_TYPES.STONE) stoneCount++;
        }
    }
    console.log(`Map Generated: ${treeCount} Trees, ${stoneCount} Stone Ores`);

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
                // Fog of War check
                if (state.map.explored[gy * state.map.width + gx] === 0) continue;

                const tile = state.map.tiles[gy][gx];
                ctx.fillStyle = tile.type.color;
                ctx.fillRect(lx * ts, ly * ts, ts, ts);

                // Add visual detail for special tiles
                if (tile.type === TILE_TYPES.GRASS) {
                    // Detailed grass blades
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                    ctx.lineWidth = 1;
                    for (let i = 0; i < 4; i++) {
                        const ox = (gx * 13 + i * 9) % (ts - 4) + 2;
                        const oy = (gy * 17 + i * 13) % (ts - 4) + 4;
                        const h = 3 + (gx + gy + i) % 4;
                        ctx.beginPath();
                        ctx.moveTo(lx * ts + ox, ly * ts + oy);
                        ctx.lineTo(lx * ts + ox + 1, ly * ts + oy - h);
                        ctx.stroke();
                        
                        // Add a second tiny blade for a tuft effect
                        ctx.beginPath();
                        ctx.moveTo(lx * ts + ox + 2, ly * ts + oy);
                        ctx.lineTo(lx * ts + ox + 3, ly * ts + oy - h + 1);
                        ctx.stroke();
                    }
                } else if (tile.type === TILE_TYPES.SOIL) {
                    // Small gray pebbles
                    for (let i = 0; i < 5; i++) {
                        const ox = (gx * 23 + i * 13) % (ts - 6) + 3;
                        const oy = (gy * 29 + i * 19) % (ts - 6) + 3;
                        const size = 1 + (gx + gy + i) % 2;
                        const gray = 100 + (gx * i) % 50;
                        ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, 0.6)`;
                        ctx.beginPath();
                        ctx.arc(lx * ts + ox, ly * ts + oy, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (tile.type === TILE_TYPES.FOREST) {
                    // Dense layered forest
                    ctx.fillStyle = '#2d5a27';
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    for (let i = 0; i < 3; i++) {
                        const ox = (gx * 31 + i * 11) % (ts - 12) + 6;
                        const oy = (gy * 37 + i * 13) % (ts - 12) + 8;
                        
                        // Small Shadow
                        ctx.fillStyle = 'rgba(0,0,0,0.2)';
                        ctx.beginPath();
                        ctx.ellipse(lx * ts + ox, ly * ts + oy + 4, 4, 2, 0, 0, Math.PI * 2);
                        ctx.fill();

                        // Trunk
                        ctx.fillStyle = '#3e2723';
                        ctx.fillRect(lx * ts + ox - 1, ly * ts + oy + 1, 2, 3);
                        
                        // Layered Conifer (3 levels)
                        const colors = ['#1b5e20', '#2e7d32', '#388e3c'];
                        for (let j = 0; j < 3; j++) {
                            ctx.fillStyle = colors[j];
                            ctx.beginPath();
                            ctx.moveTo(lx * ts + ox, ly * ts + oy - 7 + j * 2);
                            ctx.lineTo(lx * ts + ox - 5 + j, ly * ts + oy + 2 + j);
                            ctx.lineTo(lx * ts + ox + 5 - j, ly * ts + oy + 2 + j);
                            ctx.closePath();
                            ctx.fill();
                        }
                    }
                } else if (tile.type === TILE_TYPES.TREE) {
                    // Improved big tree icon
                    ctx.fillStyle = '#4e342e'; // Darker trunk
                    ctx.fillRect(lx * ts + ts * 0.4, ly * ts + ts * 0.6, ts * 0.2, ts * 0.3);
                    
                    // Layered canopy
                    ctx.fillStyle = '#2e7d32';
                    ctx.beginPath();
                    ctx.arc(lx * ts + ts * 0.5, ly * ts + ts * 0.45, ts * 0.3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#388e3c';
                    ctx.beginPath();
                    ctx.arc(lx * ts + ts * 0.4, ly * ts + ts * 0.35, ts * 0.2, 0, Math.PI * 2);
                    ctx.fill();
                } else if (tile.type === TILE_TYPES.STONE) {
                    // Stone texture (cracks/spots)
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                    for (let i = 0; i < 3; i++) {
                        const ox = (gx * 37 + i * 11) % (ts - 8) + 4;
                        const oy = (gy * 41 + i * 13) % (ts - 8) + 4;
                        ctx.beginPath();
                        ctx.moveTo(lx * ts + ox, ly * ts + oy);
                        ctx.lineTo(lx * ts + ox + 4, ly * ts + oy + 2);
                        ctx.stroke();
                    }
                }
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
    
    // Solid tiles are never walkable
    if (tile.type.solid) return false;
    
    // Water tiles are walkable only if they are "shallow" (next to land)
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
    const steps = Math.ceil(dist * 2); // Sample twice per tile length
    
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.floor(startX + (endX - startX) * t);
        const y = Math.floor(startY + (endY - startY) * t);
        
        if (x < 0 || x >= state.map.width || y < 0 || y >= state.map.height) return false;
        
        // Skip check for the very last tile (destination) so we can walk to trees/rocks
        if (x === Math.floor(endX) && y === Math.floor(endY)) continue;

        const tile = state.map.tiles[y][x];
        // If it's water (of any kind) or solid, the path is NOT clear
        if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.DEEP_WATER || tile.type.solid) {
            return false;
        }
    }
    return true;
}

// Initialize Colonists
function initEntities() {
    state.entities.push({
        id: 1,
        name: 'John',
        x: 50.5,
        y: 50.5,
        color: '#ffcc80',
        target: null,
        job: null,
        speed: 0.1,
        needs: { food: 100, rest: 100 },
        path: []
    });
    state.entities.push({
        id: 2,
        name: 'Sarah',
        x: 51.5,
        y: 50.5,
        color: '#f48fb1',
        target: null,
        job: null,
        speed: 0.12,
        needs: { food: 100, rest: 100 },
        path: []
    });
    state.entities.push({
        id: 3,
        name: 'Pete',
        x: 50.5,
        y: 51.5,
        color: '#90caf9',
        target: null,
        job: null,
        speed: 0.08,
        needs: { food: 100, rest: 100 },
        path: []
    });
}

// --- Pathfinding (A*) ---
function findPath(startX, startY, endX, endY) {
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    endX = Math.floor(endX);
    endY = Math.floor(endY);

    if (endX < 0 || endX >= state.map.width || endY < 0 || endY >= state.map.height) return null;
    const destTile = state.map.tiles[endY][endX];
    if (!isWalkable(endX, endY) && !destTile.type.harvestable) return null;

    const openSet = [{ x: startX, y: startY, g: 0, h: dist(startX, startY, endX, endY), f: 0, parent: null }];
    const closedSet = new Set();
    
    function dist(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    const maxIterations = 1000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        // Get lowest f score
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

            // Use move cost from tile type
            const tile = state.map.tiles[neighbor.y][neighbor.x];
            const cost = tile.type.moveCost || 1;

            const gScore = current.g + cost;
            let neighborNode = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);

            if (!neighborNode) {
                neighborNode = {
                    x: neighbor.x,
                    y: neighbor.y,
                    g: gScore,
                    h: dist(neighbor.x, neighbor.y, endX, endY),
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

    return null; // No path found
}

// Resize Canvas
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// Input Handling
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    // Prevent clicking through UI
    if (e.target.closest('#top-bar') || e.target.closest('#bottom-menu') || e.target.closest('#inspect-panel')) {
        return;
    }

    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) { // Right, Middle, or Shift+Left
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
                if (state.currentOrder === 'architect') {
                    if (state.map.tiles[ty][tx].type !== TILE_TYPES.WALL) {
                        state.jobs.push({ type: 'build_wall', x: tx, y: ty, progress: 0, assigned: false });
                    }
                } else if (state.currentOrder === 'chop') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.TREE) {
                        state.jobs.push({ type: 'chop', x: tx, y: ty, progress: 0, assigned: false });
                    }
                } else if (state.currentOrder === 'mine') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.STONE) {
                        state.jobs.push({ type: 'mine', x: tx, y: ty, progress: 0, assigned: false });
                    }
                } else if (state.currentOrder === 'unarchitect') {
                    if (state.map.tiles[ty][tx].type === TILE_TYPES.WALL) {
                        state.jobs.push({ type: 'destruct', x: tx, y: ty, progress: 0, assigned: false });
                    }
                }
            }
        }
    } else if (e.button === 0 && state.selectedEntity) {
        // If an entity is already selected, left-click issues a move command
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        // Check if we're clicking another entity to switch selection
        const clickedEnt = state.entities.find(ent => {
            const dx = ent.x - (worldPos.x / state.map.tileSize);
            const dy = ent.y - (worldPos.y / state.map.tileSize);
            return Math.sqrt(dx * dx + dy * dy) < 0.6;
        });

        if (clickedEnt && clickedEnt !== state.selectedEntity) {
            // Switch selection
            selectEntity(clickedEnt);
        } else if (isWalkable(tx, ty)) {
            // Move command
            if (isPathClearOfWater(state.selectedEntity.x, state.selectedEntity.y, tx, ty)) {
                // Straight line if no water/obstacles
                state.selectedEntity.path = [{ x: tx + 0.5, y: ty + 0.5 }];
                state.selectedEntity.target = state.selectedEntity.path[0];
                state.selectedEntity.job = null;
                state.selectedEntity.isManualMove = true;
                console.log(`Commanded ${state.selectedEntity.name} to ${tx}, ${ty} (Straight Line)`);
            } else {
                // Use pathfinding if water is in the way
                const path = findPath(state.selectedEntity.x, state.selectedEntity.y, tx, ty);
                if (path) {
                    state.selectedEntity.path = path;
                    state.selectedEntity.target = path[0];
                    state.selectedEntity.job = null;
                    state.selectedEntity.isManualMove = true;
                    console.log(`Commanded ${state.selectedEntity.name} to ${tx}, ${ty} (Path: ${path.length} steps)`);
                }
            }
            updateInspectPanel(state.selectedEntity);
        } else {
            // Clicked non-walkable area, deselect
            deselectEntity();
        }
    } else if (e.button === 0 && !state.currentOrder) {
        // Inspect & Select logic
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        // Check for entities first
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
    ent.isManualMove = false; // Reset manual move on new selection
    updateInspectPanel(ent);
}

function deselectEntity() {
    state.selectedEntity = null;
    document.getElementById('inspect-panel').classList.add('hidden');
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
        <p style="color: #81d4fa; font-size: 0.8em;">(Left-click to move)</p>
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
        e.preventDefault(); // Prevent scrolling
        deselectEntity();
    }
});

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
    if (state.camera.isDragging && e.button === 2) {
        // If it was a right-click drag, check if it was actually a click or a drag
        const dx = e.clientX - state.camera.dragStartX;
        const dy = e.clientY - state.camera.dragStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If moved less than 5 pixels, treat as a right-click
        if (dist < 5) {
            // Right click now does nothing specific by default, 
            // but we keep the detection logic in case we want right-click deselect or similar
        }
    }
    state.camera.isDragging = false;
});

window.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    // Smooth zoom factor
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = state.camera.zoom;
    const newZoom = Math.max(0.1, Math.min(5, state.camera.zoom * factor));
    
    if (newZoom !== oldZoom) {
        // Zoom towards mouse position
        const mouseWorldBefore = screenToWorld(e.clientX, e.clientY);
        state.camera.zoom = newZoom;
        const mouseWorldAfter = screenToWorld(e.clientX, e.clientY);
        
        state.camera.x += (mouseWorldAfter.x - mouseWorldBefore.x);
        state.camera.y += (mouseWorldAfter.y - mouseWorldBefore.y);
        
        console.log(`Zoom: ${state.camera.zoom.toFixed(2)}`);
    }
}, { passive: false });

// Update Game State
function update() {
    updateFogOfWar();
    // Update Time
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

    // Update Entities
    state.entities.forEach(ent => {
        // Freeze selected entity UNLESS it's a manual move command
        if (state.selectedEntity === ent && !ent.isManualMove) return;

        // Find job if idle
        if (!ent.job && !ent.target) {
            const availableJob = state.jobs.find(j => !j.assigned);
            if (availableJob) {
                if (isPathClearOfWater(ent.x, ent.y, availableJob.x, availableJob.y)) {
                    ent.job = availableJob;
                    availableJob.assigned = true;
                    ent.path = [{ x: availableJob.x + 0.5, y: availableJob.y + 0.5 }];
                    ent.target = ent.path[0];
                } else {
                    const path = findPath(ent.x, ent.y, availableJob.x, availableJob.y);
                    if (path) {
                        ent.job = availableJob;
                        availableJob.assigned = true;
                        ent.path = path;
                        ent.target = path[0];
                    }
                }
            }
        }

        if (ent.target) {
            const dx = ent.target.x - ent.x;
            const dy = ent.target.y - ent.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.1) {
                ent.x = ent.target.x;
                ent.y = ent.target.y;
                
                // If there's a path, move to next waypoint
                if (ent.path && ent.path.length > 0) {
                    ent.path.shift(); // Remove current waypoint
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
            // Working on job
            ent.job.progress += 0.5;
            if (ent.job.progress >= 100) {
                const tx = ent.job.x;
                const ty = ent.job.y;

                if (ent.job.type === 'build_wall') {
                    state.map.tiles[ty][tx].type = TILE_TYPES.WALL;
                } else if (ent.job.type === 'chop') {
                    state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                    state.resources.wood += 20;
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
        } else {
            // Idle movement
            if (Math.random() < 0.01) {
                const tx = Math.floor(ent.x + (Math.random() * 10 - 5));
                const ty = Math.floor(ent.y + (Math.random() * 10 - 5));
                if (isWalkable(tx, ty)) {
                    if (isPathClearOfWater(ent.x, ent.y, tx, ty)) {
                        ent.path = [{ x: tx + 0.5, y: ty + 0.5 }];
                        ent.target = ent.path[0];
                    } else {
                        const path = findPath(ent.x, ent.y, tx, ty);
                        if (path) {
                            ent.path = path;
                            ent.target = path[0];
                        }
                    }
                }
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

// Render Loop
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.translate(state.camera.x, state.camera.y);

    // Draw Map (Chunks)
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

    // Grid (only if zoomed in)
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

    // Ghost wall for architect mode
    if (state.currentOrder === 'architect') {
        const mouseWorld = screenToWorld(state.camera.lastMouseX, state.camera.lastMouseY);
        const tx = Math.floor(mouseWorld.x / state.map.tileSize);
        const ty = Math.floor(mouseWorld.y / state.map.tileSize);
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(tx * state.map.tileSize, ty * state.map.tileSize, state.map.tileSize, state.map.tileSize);
        }
    } else if (state.currentOrder === 'unarchitect') {
        const mouseWorld = screenToWorld(state.camera.lastMouseX, state.camera.lastMouseY);
        const tx = Math.floor(mouseWorld.x / state.map.tileSize);
        const ty = Math.floor(mouseWorld.y / state.map.tileSize);
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            ctx.fillRect(tx * state.map.tileSize, ty * state.map.tileSize, state.map.tileSize, state.map.tileSize);
        }
    }

    // Draw Jobs (Blueprints)
    state.jobs.forEach(job => {
        if (job.type === 'build_wall') {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + 2, state.map.tileSize - 4, state.map.tileSize - 4);
            ctx.setLineDash([]);
            
            if (job.progress > 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                const h = (state.map.tileSize - 4) * (job.progress / 100);
                ctx.fillRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + state.map.tileSize - 2 - h, state.map.tileSize - 4, h);
            }
        } else if (job.type === 'destruct') {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + 2, state.map.tileSize - 4, state.map.tileSize - 4);
            ctx.setLineDash([]);
            
            if (job.progress > 0) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                const h = (state.map.tileSize - 4) * (job.progress / 100);
                ctx.fillRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + state.map.tileSize - 2 - h, state.map.tileSize - 4, h);
            }
        }
    });

    // Draw Entities
    state.entities.forEach(ent => {
        // Selection circle
        if (state.selectedEntity === ent) {
            ctx.strokeStyle = '#81d4fa';
            ctx.lineWidth = 2 / state.camera.zoom;
            ctx.beginPath();
            ctx.arc(ent.x * state.map.tileSize, ent.y * state.map.tileSize, state.map.tileSize / 2, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = ent.color;
        ctx.beginPath();
        ctx.arc(ent.x * state.map.tileSize, ent.y * state.map.tileSize, state.map.tileSize / 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Name tag
        ctx.fillStyle = 'white';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(ent.name, ent.x * state.map.tileSize, ent.y * state.map.tileSize - 15);
    });

    // Darkening at the edges of the world
    const edgeSize = 1000; // Pixels from the edge where darkening starts
    const mapW = state.map.width * state.map.tileSize;
    const mapH = state.map.height * state.map.tileSize;

    ctx.fillStyle = 'black';
    // Left edge
    let grad = ctx.createLinearGradient(0, 0, edgeSize, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.8)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, edgeSize, mapH);

    // Right edge
    grad = ctx.createLinearGradient(mapW - edgeSize, 0, mapW, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(mapW - edgeSize, 0, edgeSize, mapH);

    // Top edge
    grad = ctx.createLinearGradient(0, 0, 0, edgeSize);
    grad.addColorStop(0, 'rgba(0,0,0,0.8)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, mapW, edgeSize);

    // Bottom edge
    grad = ctx.createLinearGradient(0, mapH - edgeSize, 0, mapH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, mapH - edgeSize, mapW, edgeSize);

    ctx.restore();

    // Screen Vignette (Atmospheric)
    const vignette = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.7
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    update();
    requestAnimationFrame(render);
}

// Global functions for UI
window.regenerateWorld = function() {
    initMap();
    updateFogOfWar();
    // Reset colonist positions to center
    state.entities.forEach(ent => {
        ent.x = state.map.width / 2 + (Math.random() - 0.5);
        ent.y = state.map.height / 2 + (Math.random() - 0.5);
        ent.target = null;
        ent.job = null;
    });
    state.jobs = [];
    console.log("World regenerated");
};

window.setOrder = function(type) {
    if (state.currentOrder === type) {
        state.currentOrder = null;
    } else {
        state.currentOrder = type;
    }
    
    // Highlight active button
    const buttons = document.querySelectorAll('#bottom-menu button');
    buttons.forEach(btn => {
        if (btn.innerText.toLowerCase() === type) {
            btn.style.background = state.currentOrder === type ? '#555' : '#333';
        } else {
            btn.style.background = '#333';
        }
    });
};

// Start Game
window.addEventListener('resize', resize);
resize();
initMap();
initEntities();
updateResourceUI();
    updateFogOfWar();
    requestAnimationFrame(render);
