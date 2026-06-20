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
        width: 512,
        height: 512,
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
        wood: 0,
        food: 10,
        gold: 0 // Добавляем золото
    },
    prevResources: {
        silver: 0,
        stone: 0,
        wood: 0,
        food: 10,
        gold: 0
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
    lastPaintedTile: null,
    selectedEntities: [],
    selectionBox: {
        active: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    },
    mineSelection: {
        active: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    },
    chopSelection: {
        active: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    },
    keys: {},
    keyPressTime: {},
};

const TILE_TYPES = {
    GRASS: { color: 'rgb(95, 94, 40)', name: 'Grass', moveCost: 1 },
    LIGHT_GRASS: { color: 'rgb(125, 124, 60)', name: 'Light Grass', moveCost: 1 },
    DARK_GRASS: { color: 'rgb(65, 64, 20)', name: 'Dark Grass', moveCost: 1.1 },
    SOIL: { color: '#5d4037', name: 'Soil', moveCost: 1.2 },
    WATER: { color: '#1976d2', name: 'Water', moveCost: 3 },
    DEEP_WATER: { color: '#0d47a1', name: 'Deep Water', solid: true },
    STONE: { color: '#757575', name: 'Stone', solid: true, harvestable: 'stone' },
    GOLD_ORE: { color: '#FFD700', name: 'Gold Ore', solid: true, harvestable: 'gold' }, // Золотая руда
    MOUNTAIN_ROCK: { color: '#555555', name: 'Mountain Rock', solid: true, harvestable: 'mountain' }, // Горная порода (чуть темнее камня)
    MOUNTAIN_ROCK_DARK: { color: '#2a2a2a', name: 'Dark Mountain Rock', solid: true }, // Блок гор (неразрушаемый)
    MOUNTAIN_SNOW: { color: '#f8f8f8', name: 'Snowy Mountain Peak', solid: true, harvestable: 'mountain' }, // Снежная вершина горы
    SAND: { color: '#c2b280', name: 'Sand', moveCost: 1.5 },
    WALL: { color: '#424242', name: 'Wall', solid: true },
    WOOD_WALL: { color: '#8B4513', name: 'Wooden Wall', solid: true },
    TREE: { color: 'rgb(95, 94, 40)', name: 'Tree', solid: true, harvestable: 'wood' },
    BRIDGE: { color: '#8B4513', name: 'Bridge', moveCost: 1.5 }
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

// Обновляет счётчик ресурса с анимацией
function updateCounter(containerId, newValue, oldValue) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Преобразуем в строки
    const newStr = newValue.toString();
    const oldStr = oldValue.toString();
    
    // Определяем максимальную длину
    const maxLength = Math.max(newStr.length, oldStr.length);
    
    // Дополняем нулями слева
    const newPadded = newStr.padStart(maxLength, '0');
    const oldPadded = oldStr.padStart(maxLength, '0');
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Создаём цифры
    for (let i = 0; i < maxLength; i++) {
        const digitEl = document.createElement('div');
        digitEl.className = 'counter-digit';
        digitEl.dataset.target = newPadded[i];
        digitEl.dataset.current = oldPadded[i];
        digitEl.textContent = oldPadded[i];
        
        if (newPadded[i] !== oldPadded[i]) {
            // Запускаем анимацию только если цифра изменилась
            animateDigitElement(digitEl, parseInt(oldPadded[i]), parseInt(newPadded[i]));
        }
        
        container.appendChild(digitEl);
    }
}

// Анимирует отдельную цифру
function animateDigitElement(el, from, to) {
    // Защита от повторных запусков
    if (el.dataset.animating === 'true') {
        el.textContent = el.dataset.target || to;
        return;
    }
    el.dataset.animating = 'true';
    
    const duration = 2000; // 2 секунды
    const framesPerSecond = 25;
    const totalFrames = Math.floor(duration / (1000 / framesPerSecond));
    let frame = 0;
    
    const animateFrame = () => {
        frame++;
        
        if (frame < totalFrames) {
            // Случайная цифра для эффекта перекручивания
            el.textContent = Math.floor(Math.random() * 10);
            
            // Маленький эффект покачивания
            el.style.transform = `translateY(${(frame % 2 === 0 ? -2 : 2)}px)`;
            
            // Следующий кадр
            requestAnimationFrame(animateFrame);
        } else {
            // Финальная цифра
            el.textContent = el.dataset.target || to;
            el.style.transform = 'translateY(0)';
            el.dataset.animating = 'false';
        }
    };
    
    // Запускаем анимацию
    requestAnimationFrame(animateFrame);
}

function updateResourceUI() {
    updateCounter('silver-count', state.resources.silver, state.prevResources.silver);
    updateCounter('stone-count', state.resources.stone, state.prevResources.stone);
    updateCounter('wood-count', state.resources.wood, state.prevResources.wood);
    updateCounter('food-count', state.resources.food, state.prevResources.food);
    updateCounter('gold-count', state.resources.gold, state.prevResources.gold);
    
    // Обновляем предыдущие значения
    state.prevResources.silver = state.resources.silver;
    state.prevResources.stone = state.resources.stone;
    state.prevResources.wood = state.resources.wood;
    state.prevResources.food = state.resources.food;
    state.prevResources.gold = state.resources.gold;
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
            const mountainNoise = Noise.fbm(nx * 0.008, ny * 0.008, 4);
            const detail = Noise.fbm(nx * 0.02, ny * 0.02, 4);
            // Less boost to keep sea level correct
            let elevation = continent * 0.85 + detail * 0.10 + mountainNoise * 0.05;
            // Normalize back to [0, 1] range (less aggressive)
            elevation = Math.min(1, Math.max(0, elevation * 0.95));
            const moisture = Noise.fbm(nx * 0.01 + 2000, ny * 0.01 + 2000, 3);
            let type;
            const sea_level = 0.42;
            if (elevation < sea_level) {
                if (elevation < sea_level - 0.15) type = TILE_TYPES.DEEP_WATER;
                else type = TILE_TYPES.WATER;
            } else {
                if (elevation < sea_level + 0.02) type = TILE_TYPES.SAND; 
                else if (elevation > 0.70) type = TILE_TYPES.SOIL; // We'll replace with mountain layers later
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
            row.push({ type, x, y, elevation, moisture });
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

    // Step 1: Generate mountain ridge lines (long, narrow ranges)
    const ridges = [];
    const numRidges = Math.floor(Noise.fbm(10000, 20000, 1) * 2) + 1; // 1-3 ridges
    
    for (let r = 0; r < numRidges; r++) {
        // Start with a random high elevation point
        let startX = Math.floor(Math.random() * (state.map.width - 100)) + 50;
        let startY = Math.floor(Math.random() * (state.map.height - 100)) + 50;
        let bestScore = -1;
        
        // Find a good starting point with high elevation
        for (let i = 0; i < 100; i++) {
            const testX = Math.floor(Math.random() * (state.map.width - 100)) + 50;
            const testY = Math.floor(Math.random() * (state.map.height - 100)) + 50;
            if (state.map.tiles[testY][testX].elevation > bestScore) {
                bestScore = state.map.tiles[testY][testX].elevation;
                startX = testX;
                startY = testY;
            }
        }
        
        // Generate ridge path
        const ridge = [];
        let currentX = startX;
        let currentY = startY;
        let angle = Math.random() * Math.PI * 2;
        const ridgeLength = 60 + Math.floor(Math.random() * 100); // 60-160 tiles long
        
        for (let i = 0; i < ridgeLength; i++) {
            ridge.push({ x: currentX, y: currentY });
            
            // Wiggle the angle slightly
            angle += (Math.random() - 0.5) * 0.4;
            
            // Move forward
            currentX += Math.cos(angle) * 1.5;
            currentY += Math.sin(angle) * 1.5;
            
            // Wrap around or stop at edges
            if (currentX < 20 || currentX > state.map.width - 20 || 
                currentY < 20 || currentY > state.map.height - 20) {
                break;
            }
        }
        
        ridges.push(ridge);
    }
    
    // Step 1.5: Also add individual mountain centers (regular mountains)
    const mountainCenters = [];
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            const tile = state.map.tiles[y][x];
            if (tile.elevation > 0.82) {
                mountainCenters.push({ x, y, elevation: tile.elevation });
            }
        }
    }
    
    // Step 2: First generate ridges, then generate individual mountains
    ridges.forEach(ridge => {
        // Calculate maximum layer size for this ridge
        const maxLayerSize = 4 + Math.floor(Math.random() * 5); // 4-8 layers (narrow!)
        
        for (let pointIdx = 0; pointIdx < ridge.length; pointIdx++) {
            const point = ridge[pointIdx];
            const distFromStart = pointIdx;
            const distFromEnd = ridge.length - 1 - pointIdx;
            const localMax = Math.min(distFromStart, distFromEnd);
            const peakFactor = localMax > ridge.length / 4 ? 1 : localMax / (ridge.length / 4);
            
            for (let layer = 0; layer <= maxLayerSize; layer++) {
                const baseRadius = (maxLayerSize - layer) * peakFactor;
                for (let dy = -Math.ceil(baseRadius + 2); dy <= Math.ceil(baseRadius + 2); dy++) {
                    for (let dx = -Math.ceil(baseRadius + 2); dx <= Math.ceil(baseRadius + 2); dx++) {
                        const nx = Math.floor(point.x) + dx;
                        const ny = Math.floor(point.y) + dy;
                        
                        if (nx < 0 || nx >= state.map.width || ny < 0 || ny >= state.map.height) continue;
                        
                        const neighborTile = state.map.tiles[ny][nx];
                        
                        // Skip if already a higher layer or water
                        if (neighborTile.type === TILE_TYPES.WATER || 
                            neighborTile.type === TILE_TYPES.DEEP_WATER ||
                            neighborTile.type === TILE_TYPES.MOUNTAIN_SNOW || 
                            neighborTile.type === TILE_TYPES.MOUNTAIN_ROCK_DARK ||
                            neighborTile.type === TILE_TYPES.MOUNTAIN_ROCK) continue;
                        
                        // Calculate distance from ridge point
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const jaggedNoise = Noise.fbm((nx + 5000) * 0.2, (ny + 5000) * 0.2, 3);
                        const noisyRadius = baseRadius + jaggedNoise * 1.5 - 0.75;
                        
                        if (distance > noisyRadius) continue;
                        
                        // Strict layer assignment
                        if (layer === 0 && peakFactor > 0.7 && jaggedNoise > 0.55) {
                            // A little snow on peaks only
                            neighborTile.type = TILE_TYPES.MOUNTAIN_SNOW;
                        } else if (layer <= 1 && peakFactor > 0.5) {
                            // Inner core: Dark mountain rock (unbreakable)
                            neighborTile.type = TILE_TYPES.MOUNTAIN_ROCK_DARK;
                        } else if (layer <= 3) {
                            // Middle layer: Mountain rock (10x slower)
                            neighborTile.type = TILE_TYPES.MOUNTAIN_ROCK;
                        } else {
                            // Outer layer: Stone (normal speed)
                            neighborTile.type = TILE_TYPES.STONE;
                        }
                    }
                }
            }
        }
    });
    
    // Step 2.5: Now generate individual mountains
    mountainCenters.forEach(center => {
        const maxLayerSize = 10 + Math.floor((center.elevation - 0.82) * 40); // 10-42 size
        const centerNoise = Noise.fbm(center.x * 0.05, center.y * 0.05, 2);
        
        for (let layer = 0; layer <= maxLayerSize; layer++) {
            const baseRadius = maxLayerSize - layer;
            for (let dy = -baseRadius - 2; dy <= baseRadius + 2; dy++) {
                for (let dx = -baseRadius - 2; dx <= baseRadius + 2; dx++) {
                    const nx = center.x + dx;
                    const ny = center.y + dy;
                    
                    if (nx < 0 || nx >= state.map.width || ny < 0 || ny >= state.map.height) continue;
                    
                    const neighborTile = state.map.tiles[ny][nx];
                    
                    // Skip if already a higher layer or water
                    if (neighborTile.type === TILE_TYPES.WATER || 
                        neighborTile.type === TILE_TYPES.DEEP_WATER ||
                        neighborTile.type === TILE_TYPES.MOUNTAIN_SNOW || 
                        neighborTile.type === TILE_TYPES.MOUNTAIN_ROCK_DARK ||
                        neighborTile.type === TILE_TYPES.MOUNTAIN_ROCK) continue;
                    
                    // Calculate distance with subtle noise
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const jaggedNoise = Noise.fbm((nx + 5000) * 0.15, (ny + 5000) * 0.15, 3);
                    const noisyRadius = baseRadius + jaggedNoise * 2.5 - 1.25 + centerNoise * 1.5;
                    
                    if (distance > noisyRadius) continue;
                    
                    // Strict layer assignment
                    if (layer === 0 && maxLayerSize >= 8 && jaggedNoise > 0.55) {
                        // A little snow on peaks only
                        neighborTile.type = TILE_TYPES.MOUNTAIN_SNOW;
                    } else if (layer <= 3 && maxLayerSize >= 7) {
                        // Inner core: Dark mountain rock (unbreakable)
                        neighborTile.type = TILE_TYPES.MOUNTAIN_ROCK_DARK;
                    } else if (layer <= 7) {
                        // Middle layer: Mountain rock (10x slower)
                        neighborTile.type = TILE_TYPES.MOUNTAIN_ROCK;
                    } else {
                        // Outer layer: Stone (normal speed)
                        neighborTile.type = TILE_TYPES.STONE;
                    }
                }
            }
        }
    });

    // Step 3: Generate gold ore ONLY on mountain edges
    const goldPositions = new Set();
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            const tile = state.map.tiles[y][x];
            // Check if this tile is a mountain edge tile (stone/mountain rock adjacent to non-mountain)
            const isMountainTile = tile.type === TILE_TYPES.STONE || tile.type === TILE_TYPES.MOUNTAIN_ROCK;
            if (isMountainTile) {
                let hasNonMountainNeighbor = false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < state.map.width && ny >= 0 && ny < state.map.height) {
                            const neighbor = state.map.tiles[ny][nx];
                            const neighborIsNotMountain = neighbor.type !== TILE_TYPES.STONE && 
                                                          neighbor.type !== TILE_TYPES.MOUNTAIN_ROCK && 
                                                          neighbor.type !== TILE_TYPES.MOUNTAIN_ROCK_DARK && 
                                                          neighbor.type !== TILE_TYPES.MOUNTAIN_SNOW;
                            if (neighborIsNotMountain) {
                                hasNonMountainNeighbor = true;
                                break;
                            }
                        }
                    }
                    if (hasNonMountainNeighbor) break;
                }
                
                if (hasNonMountainNeighbor && Math.random() < 0.15) { // 15% chance per edge tile
                    const key = `${x},${y}`;
                    goldPositions.add(key);
                    state.map.tiles[y][x].type = TILE_TYPES.GOLD_ORE;
                }
            }
        }
    }

    // Step 4: Generate normal stone deposits away from mountains
    const stoneNoiseScale = 0.018;
    const stonePositions = new Set();
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            const tile = state.map.tiles[y][x];
            const isNearMountain = [TILE_TYPES.STONE, TILE_TYPES.MOUNTAIN_ROCK, TILE_TYPES.MOUNTAIN_ROCK_DARK, TILE_TYPES.MOUNTAIN_SNOW].includes(tile.type);
            if (!isNearMountain && tile.type === TILE_TYPES.SOIL) {
                const stoneValue = Noise.fbm(x * stoneNoiseScale + 10000, y * stoneNoiseScale + 10000, 3);
                let stoneChance = 0;
                if (stoneValue > 0.75) stoneChance = 0.85;
                else if (stoneValue > 0.65) stoneChance = 0.7;
                else if (stoneValue > 0.55) stoneChance = 0.45;
                
                if (Math.random() < stoneChance) {
                    const key = `${x},${y}`;
                    stonePositions.add(key);
                    state.map.tiles[y][x].type = TILE_TYPES.STONE;
                }
            }
        }
    }
    
    // Generate Forest biome with trees (rare forests)
    const treeNoiseScale = 0.02; // Larger scale = bigger, rarer forests
    const treePositions = new Set();
    
    for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
            const tile = state.map.tiles[y][x];
            if (tile.type === TILE_TYPES.GRASS || tile.type === TILE_TYPES.DARK_GRASS || tile.type === TILE_TYPES.LIGHT_GRASS) {
                // Use noise to determine forest density
                const forestValue = Noise.fbm(x * treeNoiseScale + 8000, y * treeNoiseScale + 8000, 3);
                
                // Higher noise = more trees (rare forests)
                let treeChance = 0;
                if (forestValue > 0.75) {
                    treeChance = 0.6; // Dense forest
                } else if (forestValue > 0.65) {
                    treeChance = 0.4; // Medium forest
                } else if (forestValue > 0.55) {
                    treeChance = 0.2; // Sparse forest
                }
                
                if (Math.random() < treeChance) {
                    const key = `${x},${y}`;
                    
                    // Check if there are no trees too close
                    let canPlaceTree = true;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const checkKey = `${x + dx},${y + dy}`;
                            if (treePositions.has(checkKey)) {
                                canPlaceTree = false;
                                break;
                            }
                        }
                        if (!canPlaceTree) break;
                    }
                    
                    if (canPlaceTree) {
                        treePositions.add(key);
                        state.map.tiles[y][x].type = TILE_TYPES.TREE;
                    }
                }
            }
        }
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
            
            let color = 'rgba(0,0,0,0)';
            if (gy >= 0 && gy < state.map.height && gx >= 0 && gx < state.map.width) {
                const tile = state.map.tiles[gy][gx];
                if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.DEEP_WATER || tile.type === TILE_TYPES.BRIDGE) {
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
    
    ctx.imageSmoothingEnabled = false;
    for (let ly = 0; ly < size; ly++) {
        for (let lx = 0; lx < size; lx++) {
            const gy = chunk.cy * size + ly;
            const gx = chunk.cx * size + lx;
            if (gy < state.map.height && gx < state.map.width) {
                const tile = state.map.tiles[gy][gx];
                if (tile.type === TILE_TYPES.STONE) {
                    ctx.fillStyle = tile.type.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                    for (let py = 0; py < ts; py += 4) {
                        for (let px = 0; px < ts; px += 4) {
                            if ((px + py + gx + gy) % 3 === 0) {
                                ctx.fillRect(lx * ts + px, ly * ts + py, 2, 2);
                            }
                        }
                    }
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                    ctx.fillRect(lx * ts, ly * ts, 3, 3);
                    ctx.fillRect(lx * ts + ts - 3, ly * ts, 3, 3);
                    ctx.fillRect(lx * ts, ly * ts + ts - 3, 3, 3);
                    ctx.fillRect(lx * ts + ts - 3, ly * ts + ts - 3, 3, 3);
                } else if (tile.type === TILE_TYPES.GOLD_ORE) {
                    // Base: stone background
                    ctx.fillStyle = TILE_TYPES.STONE.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    // Add stone texture same as regular stone
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                    for (let py = 0; py < ts; py += 4) {
                        for (let px = 0; px < ts; px += 4) {
                            if ((px + py + gx + gy) % 3 === 0) {
                                ctx.fillRect(lx * ts + px, ly * ts + py, 2, 2);
                            }
                        }
                    }
                    
                    // Add gold veins/inlays
                    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
                    
                    // Use seeded random for consistent gold vein placement
                    const seed = gx * 1000 + gy;
                    
                    // Draw gold veins
                    const veinCount = 3 + (seed % 3);
                    for (let i = 0; i < veinCount; i++) {
                        const veinX = lx * ts + (seed % (ts - 12) + 6);
                        const veinY = ly * ts + ((seed * 2 + i * 10) % (ts - 12) + 6);
                        const veinSize = 4 + (seed * 3 + i) % 6;
                        
                        // Draw irregular gold shapes
                        ctx.beginPath();
                        ctx.arc(veinX, veinY, veinSize, 0, Math.PI * 2);
                        ctx.fill();
                        
                        // Add small satellite gold pieces
                        for (let j = 0; j < 2; j++) {
                            const offsetX = (seed * (j + 1) + i * 5) % 8 - 4;
                            const offsetY = (seed * (j + 2) + i * 7) % 8 - 4;
                            ctx.beginPath();
                            ctx.arc(veinX + offsetX, veinY + offsetY, veinSize / 2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    
                    // Add bright highlights on gold
                    ctx.fillStyle = 'rgba(255, 255, 200, 0.7)';
                    for (let i = 0; i < veinCount; i++) {
                        const veinX = lx * ts + (seed % (ts - 12) + 6) - 1;
                        const veinY = ly * ts + ((seed * 2 + i * 10) % (ts - 12) + 6) - 1;
                        ctx.beginPath();
                        ctx.arc(veinX, veinY, 2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    
                    // Add corner shading (same as stone)
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                    ctx.fillRect(lx * ts, ly * ts, 3, 3);
                    ctx.fillRect(lx * ts + ts - 3, ly * ts, 3, 3);
                    ctx.fillRect(lx * ts, ly * ts + ts - 3, 3, 3);
                    ctx.fillRect(lx * ts + ts - 3, ly * ts + ts - 3, 3, 3);
                } else if (tile.type === TILE_TYPES.MOUNTAIN_ROCK) {
                    // Darker, more rugged mountain rock
                    ctx.fillStyle = tile.type.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    // Add dark texture
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                    for (let py = 0; py < ts; py += 4) {
                        for (let px = 0; px < ts; px += 4) {
                            if ((px + py + gx + gy) % 2 === 0) {
                                ctx.fillRect(lx * ts + px, ly * ts + py, 3, 3);
                            }
                        }
                    }
                    
                    // Add light highlights on edges
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                    ctx.fillRect(lx * ts + 1, ly * ts + 1, ts - 2, 1);
                    ctx.fillRect(lx * ts + 1, ly * ts + 1, 1, ts - 2);
                    
                    // Add darker corner shading
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                    ctx.fillRect(lx * ts, ly * ts, 4, 4);
                    ctx.fillRect(lx * ts + ts - 4, ly * ts, 4, 4);
                    ctx.fillRect(lx * ts, ly * ts + ts - 4, 4, 4);
                    ctx.fillRect(lx * ts + ts - 4, ly * ts + ts - 4, 4, 4);
                } else if (tile.type === TILE_TYPES.MOUNTAIN_ROCK_DARK) {
                    // Even darker mountain rock (middle layer)
                    ctx.fillStyle = tile.type.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    // Add very dark texture
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    for (let py = 0; py < ts; py += 4) {
                        for (let px = 0; px < ts; px += 4) {
                            if ((px + py + gx + gy) % 3 === 0) {
                                ctx.fillRect(lx * ts + px, ly * ts + py, 3, 3);
                            }
                        }
                    }
                    
                    // Add subtle light highlights
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.fillRect(lx * ts + 1, ly * ts + 1, ts - 2, 1);
                    ctx.fillRect(lx * ts + 1, ly * ts + 1, 1, ts - 2);
                    
                    // Add very dark corner shading
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                    ctx.fillRect(lx * ts, ly * ts, 4, 4);
                    ctx.fillRect(lx * ts + ts - 4, ly * ts, 4, 4);
                    ctx.fillRect(lx * ts, ly * ts + ts - 4, 4, 4);
                    ctx.fillRect(lx * ts + ts - 4, ly * ts + ts - 4, 4, 4);
                } else if (tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                    // Snowy mountain peak
                    ctx.fillStyle = tile.type.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    // Add snow texture (multiple sizes of bright spots
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                    for (let py = 0; py < ts; py += 4) {
                        for (let px = 0; px < ts; px += 4) {
                            if ((px + py + gx + gy) % 3 === 0) {
                                ctx.beginPath();
                                ctx.arc(lx * ts + px + 1, ly * ts + py + 1, 1.5, 0, Math.PI * 2);
                                ctx.fill();
                            }
                            if ((px + py + gx + gy) % 5 === 0) {
                                ctx.beginPath();
                                ctx.arc(lx * ts + px + 3, ly * ts + py + 2, 1, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        }
                    }
                    
                    // Add subtle blue shadow for depth
                    ctx.fillStyle = 'rgba(180, 180, 220, 0.35)';
                    for (let py = 0; py < ts; py += 5) {
                        for (let px = 0; px < ts; px += 5) {
                            if ((px + py + gx + gy) % 4 === 1) {
                                ctx.fillRect(lx * ts + px, ly * ts + py, 2, 2);
                            }
                        }
                    }
                    
                    // Add light corner highlights
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
                    ctx.fillRect(lx * ts + 1, ly * ts + 1, ts - 2, 1);
                    ctx.fillRect(lx * ts + 1, ly * ts + 1, 1, ts - 2);
                    
                    // Add very light corner shading
                    ctx.fillStyle = 'rgba(0, 0, 60, 0.12)';
                    ctx.fillRect(lx * ts, ly * ts, 3, 3);
                    ctx.fillRect(lx * ts + ts - 3, ly * ts, 3, 3);
                    ctx.fillRect(lx * ts, ly * ts + ts - 3, 3, 3);
                    ctx.fillRect(lx * ts + ts - 3, ly * ts + ts - 3, 3, 3);
                }
            }
        }
    }
    ctx.imageSmoothingEnabled = true;

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
                } else if (tile.type === TILE_TYPES.WALL) {
                    ctx.fillStyle = tile.type.color;
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    const hasTopWall = gy > 0 && state.map.tiles[gy - 1][gx].type === TILE_TYPES.WALL;
                    const hasBottomWall = gy < state.map.height - 1 && state.map.tiles[gy + 1][gx].type === TILE_TYPES.WALL;
                    const hasLeftWall = gx > 0 && state.map.tiles[gy][gx - 1].type === TILE_TYPES.WALL;
                    const hasRightWall = gx < state.map.width - 1 && state.map.tiles[gy][gx + 1].type === TILE_TYPES.WALL;
                    
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                    ctx.lineWidth = 2;
                    
                    if (!hasTopWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts, ly * ts);
                        ctx.lineTo(lx * ts + ts, ly * ts);
                        ctx.stroke();
                    }
                    if (!hasBottomWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts, ly * ts + ts);
                        ctx.lineTo(lx * ts + ts, ly * ts + ts);
                        ctx.stroke();
                    }
                    if (!hasLeftWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts, ly * ts);
                        ctx.lineTo(lx * ts, ly * ts + ts);
                        ctx.stroke();
                    }
                    if (!hasRightWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts + ts, ly * ts);
                        ctx.lineTo(lx * ts + ts, ly * ts + ts);
                        ctx.stroke();
                    }
                } else if (tile.type === TILE_TYPES.WOOD_WALL) {
                    // Draw wooden wall with planks
                    ctx.fillStyle = '#6B4423';
                    ctx.fillRect(lx * ts, ly * ts, ts, ts);
                    
                    // Draw vertical planks
                    ctx.fillStyle = '#8B5A2B';
                    for (let i = 0; i < 4; i++) {
                        ctx.fillRect(lx * ts + i * (ts / 4) + 1, ly * ts, (ts / 4) - 2, ts);
                    }
                    
                    // Draw wood grain texture
                    ctx.fillStyle = 'rgba(93, 52, 29, 0.3)';
                    for (let i = 0; i < 8; i++) {
                        const xOffset = (i % 2) * 8;
                        ctx.fillRect(lx * ts + xOffset, ly * ts + i * (ts / 8) + 4, ts - xOffset, 2);
                    }
                    
                    const wallType = tile.type;
                    const hasTopWall = gy > 0 && state.map.tiles[gy - 1][gx].type === wallType;
                    const hasBottomWall = gy < state.map.height - 1 && state.map.tiles[gy + 1][gx].type === wallType;
                    const hasLeftWall = gx > 0 && state.map.tiles[gy][gx - 1].type === wallType;
                    const hasRightWall = gx < state.map.width - 1 && state.map.tiles[gy][gx + 1].type === wallType;
                    
                    // Darken edges that aren't connected
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                    ctx.lineWidth = 3;
                    
                    if (!hasTopWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts, ly * ts);
                        ctx.lineTo(lx * ts + ts, ly * ts);
                        ctx.stroke();
                    }
                    if (!hasBottomWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts, ly * ts + ts);
                        ctx.lineTo(lx * ts + ts, ly * ts + ts);
                        ctx.stroke();
                    }
                    if (!hasLeftWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts, ly * ts);
                        ctx.lineTo(lx * ts, ly * ts + ts);
                        ctx.stroke();
                    }
                    if (!hasRightWall) {
                        ctx.beginPath();
                        ctx.moveTo(lx * ts + ts, ly * ts);
                        ctx.lineTo(lx * ts + ts, ly * ts + ts);
                        ctx.stroke();
                    }
                } else if (tile.type === TILE_TYPES.TREE) {
                    // Draw tree shadow first (so it appears under the tree)
                    const shadowX = lx * ts + ts * 0.1;
                    const shadowY = ly * ts + ts * 0.7;
                    const shadowWidth = ts * 0.8;
                    const shadowHeight = ts * 0.25;
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                    ctx.beginPath();
                    ctx.ellipse(shadowX + shadowWidth / 2, shadowY + shadowHeight / 2, shadowWidth / 2, shadowHeight / 2, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // Draw tree trunk (longer)
                    ctx.fillStyle = '#8B4513';
                    const trunkWidth = ts * 0.25;
                    const trunkHeight = ts * 0.7;
                    const trunkX = lx * ts + (ts - trunkWidth) / 2;
                    const trunkY = ly * ts + ts - trunkHeight;
                    ctx.fillRect(trunkX, trunkY, trunkWidth, trunkHeight);
                    
                    // Draw tree foliage (polygonal low-poly style)
                    const foliageColors = ['#228B22', '#2E8B2E', '#3CB371', '#2E8B57', '#32CD32'];
                    const foliageY = ly * ts + ts * 0.05;
                    const foliageWidth = ts * 0.95;
                    const foliageHeight = ts * 0.65;
                    const foliageX = lx * ts + (ts - foliageWidth) / 2;
                    
                    // Draw multiple polygonal layers for foliage
                    for (let layer = 0; layer < 3; layer++) {
                        const layerWidth = foliageWidth * (1 - layer * 0.18);
                        const layerHeight = foliageHeight * (1 - layer * 0.12);
                        const layerX = lx * ts + (ts - layerWidth) / 2;
                        const layerY = foliageY + layer * (foliageHeight * 0.12);
                        
                        ctx.fillStyle = foliageColors[layer % foliageColors.length];
                        
                        // Draw a low-poly polygon for each layer
                        ctx.beginPath();
                        // Bottom left corner
                        ctx.moveTo(layerX + layerWidth * 0.08, layerY + layerHeight);
                        // Left side
                        ctx.lineTo(layerX + layerWidth * 0.03, layerY + layerHeight * 0.55);
                        // Top left
                        ctx.lineTo(layerX + layerWidth * 0.18, layerY + layerHeight * 0.18);
                        // Top center
                        ctx.lineTo(layerX + layerWidth * 0.5, layerY);
                        // Top right
                        ctx.lineTo(layerX + layerWidth * 0.82, layerY + layerHeight * 0.18);
                        // Right side
                        ctx.lineTo(layerX + layerWidth * 0.97, layerY + layerHeight * 0.55);
                        // Bottom right corner
                        ctx.lineTo(layerX + layerWidth * 0.92, layerY + layerHeight);
                        // Close the polygon
                        ctx.closePath();
                        ctx.fill();
                        
                        // Add some darker shade triangles for 3D effect
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                        ctx.beginPath();
                        ctx.moveTo(layerX + layerWidth * 0.5, layerY);
                        ctx.lineTo(layerX + layerWidth * 0.82, layerY + layerHeight * 0.18);
                        ctx.lineTo(layerX + layerWidth * 0.62, layerY + layerHeight * 0.42);
                        ctx.closePath();
                        ctx.fill();
                    }
                } else if (tile.type === TILE_TYPES.BRIDGE) {
                    const baseX = lx * ts;
                    const baseY = ly * ts;
                    const gx = chunk.cx * state.map.chunkSize + lx;
                    const gy = chunk.cy * state.map.chunkSize + ly;

                    // Check neighbors (up, down, left, right)
                    let connectUp = false, connectDown = false, connectLeft = false, connectRight = false;
                    const dirs = [[0, -1, 'up'], [0, 1, 'down'], [-1, 0, 'left'], [1, 0, 'right']];
                    dirs.forEach(([dx, dy, dir]) => {
                        const nx = gx + dx;
                        const ny = gy + dy;
                        if (nx >= 0 && nx < state.map.width && ny >= 0 && ny < state.map.height) {
                            const neighbor = state.map.tiles[ny][nx];
                            if (neighbor.type === TILE_TYPES.BRIDGE || 
                                (neighbor.type !== TILE_TYPES.WATER && neighbor.type !== TILE_TYPES.DEEP_WATER)) {
                                if (dir === 'up') connectUp = true;
                                if (dir === 'down') connectDown = true;
                                if (dir === 'left') connectLeft = true;
                                if (dir === 'right') connectRight = true;
                            }
                        }
                    });

                    // Draw center post
                    ctx.fillStyle = '#5D3A1A';
                    ctx.fillRect(baseX + ts * 0.35, baseY + ts * 0.35, ts * 0.3, ts * 0.3);

                    // Draw connections in all directions
                    ctx.fillStyle = '#8B5A2B';
                    
                    // Up connection
                    if (connectUp) ctx.fillRect(baseX + ts * 0.35, baseY, ts * 0.3, ts * 0.35);
                    // Down connection
                    if (connectDown) ctx.fillRect(baseX + ts * 0.35, baseY + ts * 0.65, ts * 0.3, ts * 0.35);
                    // Left connection
                    if (connectLeft) ctx.fillRect(baseX, baseY + ts * 0.35, ts * 0.35, ts * 0.3);
                    // Right connection
                    if (connectRight) ctx.fillRect(baseX + ts * 0.65, baseY + ts * 0.35, ts * 0.35, ts * 0.3);

                    // Draw planks
                    ctx.fillStyle = '#A67C52';
                    
                    // Up planks
                    if (connectUp) {
                        for (let i = 0; i < 2; i++) {
                            ctx.fillRect(baseX + ts * 0.37 + i * ts * 0.14, baseY + ts * 0.05, ts * 0.1, ts * 0.45);
                        }
                    }
                    // Down planks
                    if (connectDown) {
                        for (let i = 0; i < 2; i++) {
                            ctx.fillRect(baseX + ts * 0.37 + i * ts * 0.14, baseY + ts * 0.5, ts * 0.1, ts * 0.45);
                        }
                    }
                    // Left planks
                    if (connectLeft) {
                        for (let i = 0; i < 2; i++) {
                            ctx.fillRect(baseX + ts * 0.05, baseY + ts * 0.37 + i * ts * 0.14, ts * 0.45, ts * 0.1);
                        }
                    }
                    // Right planks
                    if (connectRight) {
                        for (let i = 0; i < 2; i++) {
                            ctx.fillRect(baseX + ts * 0.5, baseY + ts * 0.37 + i * ts * 0.14, ts * 0.45, ts * 0.1);
                        }
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
    
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const ncx = cx + dx;
            const ncy = cy + dy;
            if (state.map.chunks[ncy] && state.map.chunks[ncy][ncx]) {
                state.map.chunks[ncy][ncx].dirty = true;
            }
        }
    }
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

function isTileOccupied(tx, ty, excludeEnt) {
    // Персонажи могут проходить через друг друга
    return false;
}

function isWalkable(tx, ty) {
    if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) return false;
    const tile = state.map.tiles[ty][tx];
    if (tile.type.solid) return false;
    if (tile.type === TILE_TYPES.BRIDGE) return true;
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
    state.nextJobId = 1;
    state.entities.push({
        id: 1, name: 'Makcum', x: 50.5, y: 50.5, color: '#ffcc80', target: null, job: null,
        speed: 0.1, needs: { food: 100, rest: 100 }, path: [], currentSpeedModifier: 1.0, statusMessages: [], taskQueue: []
    });
    state.entities.push({
        id: 2, name: 'Yaroslav', x: 51.5, y: 50.5, color: '#f48fb1', target: null, job: null,
        speed: 0.12, needs: { food: 100, rest: 100 }, path: [], currentSpeedModifier: 1.0, statusMessages: [], taskQueue: []
    });
    state.entities.push({
        id: 3, name: "Admin", x: 50.5, y: 51.5, color: '#90caf9', target: null, job: null,
        speed: 0.08, needs: { food: 100, rest: 100 }, path: [], currentSpeedModifier: 1.0, statusMessages: [], taskQueue: []
    });
    updateCharacterMenu();
}

function findPath(startX, startY, endX, endY) {
    startX = Math.floor(startX); startY = Math.floor(startY);
    endX = Math.floor(endX); endY = Math.floor(endY);
    if (endX < 0 || endX >= state.map.width || endY < 0 || endY >= state.map.height) return null;
    const openSet = [{ x: startX, y: startY, g: 0, h: dist(startX, startY, endX, endY), f: 0, parent: null }];
    const closedSet = new Set();
    function dist(x1, y1, x2, y2) { 
        // Euclidean distance for better diagonal handling
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)); 
    }
    const maxIterations = 10000;
    let iterations = 0;
    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        let currentIdx = 0;
        for (let i = 1; i < openSet.length; i++) { if (openSet[i].f < openSet[currentIdx].f) currentIdx = i; }
        const current = openSet.splice(currentIdx, 1)[0];
        if (current.x === endX && current.y === endY) {
            // Reconstruct path
            let path = [];
            let temp = current;
            while (temp) { path.push({ x: temp.x + 0.5, y: temp.y + 0.5 }); temp = temp.parent; }
            path = path.reverse();
            
            // Path smoothing (remove redundant points that are on a straight line)
            if (path.length > 2) {
                const smoothedPath = [path[0]];
                for (let i = 2; i < path.length; i++) {
                    const p0 = smoothedPath[smoothedPath.length - 1];
                    const p1 = path[i - 1];
                    const p2 = path[i];
                    // Check if p1 is on the line between p0 and p2 (using cross product)
                    const cross = (p2.x - p0.x) * (p1.y - p0.y) - (p2.y - p0.y) * (p1.x - p0.x);
                    if (Math.abs(cross) > 0.001) {
                        smoothedPath.push(p1);
                    }
                }
                smoothedPath.push(path[path.length - 1]);
                return smoothedPath;
            }
            return path;
        }
        closedSet.add(`${current.x},${current.y}`);
        // 8-directional neighbors
        const neighbors = [
            { x: current.x + 1, y: current.y },
            { x: current.x - 1, y: current.y },
            { x: current.x, y: current.y + 1 },
            { x: current.x, y: current.y - 1 },
            { x: current.x + 1, y: current.y + 1 }, // Diagonals
            { x: current.x - 1, y: current.y + 1 },
            { x: current.x + 1, y: current.y - 1 },
            { x: current.x - 1, y: current.y - 1 }
        ];
        for (const neighbor of neighbors) {
            if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;
            
            const isDiagonal = (Math.abs(neighbor.x - current.x) + Math.abs(neighbor.y - current.y) === 2);
            const isDest = neighbor.x === endX && neighbor.y === endY;
            
            if (!isWalkable(neighbor.x, neighbor.y) && !isDest) continue;
            
            // For diagonals, check that both orthogonal neighbors are walkable to prevent cutting corners
            if (isDiagonal) {
                if (!isWalkable(current.x, neighbor.y) || !isWalkable(neighbor.x, current.y)) continue;
            }
            
            const cost = state.map.tiles[neighbor.y][neighbor.x].type.moveCost || 1;
            // Diagonal cost is √2 ≈ 1.4142 times more
            const stepCost = isDiagonal ? cost * 1.4142 : cost;
            const gScore = current.g + stepCost;
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
    
    // Check if we've already painted this tile
    if (state.lastPaintedTile && state.lastPaintedTile.x === tx && state.lastPaintedTile.y === ty) {
        return;
    }
    // Update last painted tile
    state.lastPaintedTile = { x: tx, y: ty };
    
    if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
        let jobType = null;
        if (state.currentOrder === 'architect') jobType = 'build_wall';
        else if (state.currentOrder === 'bridge') jobType = 'build_bridge';
        else if (state.currentOrder === 'mine') jobType = 'mine';
        else if (state.currentOrder === 'chop') jobType = 'chop';
        else if (state.currentOrder === 'unarchitect') jobType = 'destruct';

        const existingJobIndex = state.jobs.findIndex(j => j.x === tx && j.y === ty && j.type === jobType);

        if (existingJobIndex !== -1) {
            const removedJob = state.jobs[existingJobIndex];
            state.jobs.splice(existingJobIndex, 1);
            state.entities.forEach(ent => {
                if (ent.job === removedJob) {
                    ent.job = null;
                }
            });
            if (removedJob.type === 'build_wall') {
                state.resources.stone += 12;
                updateResourceUI();
            }
            if (removedJob.type === 'build_wood_wall') {
                state.resources.wood += 8;
                updateResourceUI();
            }
            if (removedJob.type === 'build_bridge') {
                state.resources.wood += 10;
                updateResourceUI();
            }
        } else {
            let job = null;
            if (state.currentOrder === 'architect') {
                if (!state.buildType) {
                    // Default to stone wall if no build type selected
                    state.buildType = 'stone_wall';
                }
                
                if (state.buildType === 'stone_wall' && state.map.tiles[ty][tx].type !== TILE_TYPES.WALL && state.map.tiles[ty][tx].type !== TILE_TYPES.STONE && state.map.tiles[ty][tx].type !== TILE_TYPES.WATER && state.map.tiles[ty][tx].type !== TILE_TYPES.DEEP_WATER) {
                    if (state.resources.stone >= 12) {
                        state.resources.stone -= 12;
                        updateResourceUI();
                        job = { id: state.nextJobId++, type: 'build_wall', x: tx, y: ty, progress: 0, assigned: false };
                    }
                } else if (state.buildType === 'wood_wall' && state.map.tiles[ty][tx].type !== TILE_TYPES.WALL && state.map.tiles[ty][tx].type !== TILE_TYPES.WOOD_WALL && state.map.tiles[ty][tx].type !== TILE_TYPES.STONE && state.map.tiles[ty][tx].type !== TILE_TYPES.WATER && state.map.tiles[ty][tx].type !== TILE_TYPES.DEEP_WATER) {
                    if (state.resources.wood >= 8) {
                        state.resources.wood -= 8;
                        updateResourceUI();
                        job = { id: state.nextJobId++, type: 'build_wood_wall', x: tx, y: ty, progress: 0, assigned: false };
                    }
                }
            }
            else if (state.currentOrder === 'bridge' && state.map.tiles[ty][tx].type === TILE_TYPES.WATER && state.map.tiles[ty][tx].type !== TILE_TYPES.BRIDGE && state.map.tiles[ty][tx].type !== TILE_TYPES.STONE) {
                if (state.resources.wood >= 10) {
                    state.resources.wood -= 10;
                    updateResourceUI();
                    job = { id: state.nextJobId++, type: 'build_bridge', x: tx, y: ty, progress: 0, assigned: false };
                }
            }
            else if (state.currentOrder === 'mine' && (state.map.tiles[ty][tx].type === TILE_TYPES.STONE || state.map.tiles[ty][tx].type === TILE_TYPES.GOLD_ORE || state.map.tiles[ty][tx].type === TILE_TYPES.MOUNTAIN_ROCK || state.map.tiles[ty][tx].type === TILE_TYPES.MOUNTAIN_SNOW)) {
                const tile = state.map.tiles[ty][tx];
                let resource;
                if (tile.type === TILE_TYPES.GOLD_ORE) {
                    resource = 'gold';
                } else if (tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_ROCK_DARK || tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                    resource = 'mountain';
                } else {
                    resource = 'stone';
                }
                job = { id: state.nextJobId++, type: 'mine', x: tx, y: ty, progress: 0, assigned: false, resource: resource };
            }
            else if (state.currentOrder === 'chop' && state.map.tiles[ty][tx].type === TILE_TYPES.TREE) job = { id: state.nextJobId++, type: 'chop', x: tx, y: ty, progress: 0, assigned: false };
            else if (state.currentOrder === 'unarchitect' && (state.map.tiles[ty][tx].type === TILE_TYPES.WALL || state.map.tiles[ty][tx].type === TILE_TYPES.WOOD_WALL || state.map.tiles[ty][tx].type === TILE_TYPES.BRIDGE)) job = { id: state.nextJobId++, type: 'destruct', x: tx, y: ty, progress: 0, assigned: false };
            if (job) { 
                state.jobs.push(job); 
                state.selectedEntities.forEach(ent => {
                    if (!ent.taskQueue) ent.taskQueue = []; // Ensure taskQueue exists
                    if (!ent.job) {
                        assignJobToEntity(ent, job);
                    } else {
                        ent.taskQueue.push(job); // Add to queue if already working
                    }
                });
                updateActionPanel(); // Update panel when adding tasks
            }
        }
    }
}

window.addEventListener('contextmenu', (e) => e.preventDefault());

let isDraggingAnything = false;

window.addEventListener('mousedown', (e) => {
    // Don't handle map events if we're dragging widget or panel
    if (isDraggingWidget || isDraggingPanel) return;
    
    if (e.target.closest('#top-bar') || e.target.closest('#bottom-menu') || e.target.closest('#inspect-panel') || e.target.closest('#character-menu') || e.target.closest('#regen-btn') || e.target.closest('#architect-menu') || e.target.closest('#inspect-widget')) return;
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        state.camera.isDragging = true;
        state.camera.lastMouseX = e.clientX; state.camera.lastMouseY = e.clientY;
        state.camera.dragStartX = e.clientX; state.camera.dragStartY = e.clientY;
        return;
    }
    if (e.button === 0) {
        if (state.currentOrder === 'mine') {
            // Start selection for multiple tiles
            state.mineSelection.active = true;
            state.mineSelection.startX = e.clientX;
            state.mineSelection.startY = e.clientY;
            state.mineSelection.endX = e.clientX;
            state.mineSelection.endY = e.clientY;
        } else if (state.currentOrder === 'chop') {
            // Start selection for multiple trees
            state.chopSelection.active = true;
            state.chopSelection.startX = e.clientX;
            state.chopSelection.startY = e.clientY;
            state.chopSelection.endX = e.clientX;
            state.chopSelection.endY = e.clientY;
        } else if (state.currentOrder) {
            state.isPainting = true;
            state.lastPaintedTile = null; // Reset for new painting session
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
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            const tile = state.map.tiles[ty][tx];
            let job = null;
            
            // Проверка: дерево? Создаём задачу на срубку
            if (tile.type === TILE_TYPES.TREE) {
                const existingJob = state.jobs.find(j => j.type === 'chop' && j.x === tx && j.y === ty);
                if (!existingJob) {
                    job = { id: state.nextJobId++, type: 'chop', x: tx, y: ty, progress: 0, assigned: false };
                }
            }
            // Проверка: камень/руда? Создаём задачу на добычу
            else if (tile.type === TILE_TYPES.STONE || tile.type === TILE_TYPES.GOLD_ORE || 
                     tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                const existingJob = state.jobs.find(j => j.type === 'mine' && j.x === tx && j.y === ty);
                if (!existingJob) {
                    let resource;
                    if (tile.type === TILE_TYPES.GOLD_ORE) {
                        resource = 'gold';
                    } else if (tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                        resource = 'mountain';
                    } else {
                        resource = 'stone';
                    }
                    job = { id: state.nextJobId++, type: 'mine', x: tx, y: ty, progress: 0, assigned: false, resource: resource };
                }
            }
            
            if (job) {
                state.jobs.push(job);
                
                // Определяем, какие персонажи будут выполнять
                let charactersToAssign = [];
                if (state.selectedEntities.length > 0) {
                    charactersToAssign = [...state.selectedEntities];
                } else {
                    // Ищем ближайшего свободного персонажа к клику
                    let closestEnt = null;
                    let closestDist = Infinity;
                    const clickX = tx + 0.5;
                    const clickY = ty + 0.5;
                    state.entities.forEach(ent => {
                        if (!ent.job && !ent.status) {
                            const dx = ent.x - clickX;
                            const dy = ent.y - clickY;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist < closestDist) {
                                closestDist = dist;
                                closestEnt = ent;
                            }
                        }
                    });
                    if (closestEnt) {
                        charactersToAssign.push(closestEnt);
                    }
                }
                
                // Назначаем задачи
                charactersToAssign.forEach(ent => {
                    if (!ent.taskQueue) ent.taskQueue = [];
                    if (!ent.job) {
                        assignJobToEntity(ent, job);
                    } else {
                        ent.taskQueue.push(job);
                    }
                });
                
                updateActionPanel();
                return;
            }
        }
        
        // Если не было задачи, делаем обычное движение
        if (state.selectedEntities.length > 0) {
            if (isWalkable(tx, ty)) {
                const assignedTiles = new Set();
                state.selectedEntities.forEach(ent => {
                    if (ent.job) {
                        ent.job.assigned = false;
                        ent.job = null;
                    }
                    if (ent.taskQueue) {
                        ent.taskQueue.forEach(job => job.assigned = false);
                        ent.taskQueue = [];
                    }

                    let targetX = tx;
                    let targetY = ty;
                    
                    if (assignedTiles.has(`${targetX},${targetY}`) || isTileOccupied(targetX, targetY, ent)) {
                        let found = false;
                        for (let radius = 1; radius < 5 && !found; radius++) {
                            for (let dy = -radius; dy <= radius && !found; dy++) {
                                for (let dx = -radius; dx <= radius && !found; dx++) {
                                    const nx = tx + dx;
                                    const ny = ty + dy;
                                    if (isWalkable(nx, ny) && !assignedTiles.has(`${nx},${ny}`) && !isTileOccupied(nx, ny, ent)) {
                                        targetX = nx;
                                        targetY = ny;
                                        found = true;
                                    }
                                }
                            }
                        }
                    }
                    assignedTiles.add(`${targetX},${targetY}`);

                    if (isPathClearOfWater(ent.x, ent.y, targetX, targetY)) {
                        ent.path = [{ x: targetX + 0.5, y: targetY + 0.5 }]; ent.target = ent.path[0]; ent.isManualMove = true;
                    } else {
                        const path = findPath(ent.x, ent.y, targetX, targetY);
                        if (path) { ent.path = path; ent.target = path[0]; ent.isManualMove = true; }
                    }
                });
                updateActionPanel();
            }
        }
    }
});

function selectEntity(ent) {
    // Если персонаж уже выбран - снимаем выбор
    if (state.selectedEntities.length === 1 && state.selectedEntities[0] === ent) {
        deselectEntity();
        return;
    }
    // Иначе выбираем только его
    state.selectedEntities = [ent]; 
    ent.isManualMove = false; 
    updateInspectPanel(ent); 
    updateCharacterMenu();
}

function deselectEntity() {
    state.selectedEntities = []; 
    document.getElementById('inspect-panel').classList.add('hidden'); 
    document.getElementById('inspect-widget').classList.add('hidden'); 
    isInspectMinimized = false;
    updateCharacterMenu();
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
    const widget = document.getElementById('inspect-widget');
    const widgetAvatar = document.getElementById('widget-avatar');
    const title = document.getElementById('inspect-title');
    const content = document.getElementById('inspect-content');
    
    // Show panel and hide widget
    panel.classList.remove('hidden');
    widget.classList.add('hidden');
    
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

let isInspectMinimized = false;
let widgetPosition = { left: 35, bottom: 140 };
let isDraggingWidget = false;
let isDraggingPanel = false;
let dragOffset = { x: 0, y: 0 };

window.toggleInspectPanel = function() {
    const panel = document.getElementById('inspect-panel');
    const widget = document.getElementById('inspect-widget');
    
    if (isInspectMinimized) {
        // Expand
        panel.style.left = widgetPosition.left + 'px';
        panel.style.bottom = widgetPosition.bottom + 'px';
        panel.classList.remove('hidden');
        widget.classList.add('hidden');
        isInspectMinimized = false;
    } else {
        // Minimize
        const panelRect = panel.getBoundingClientRect();
        widgetPosition.left = parseInt(panel.style.left) || 35;
        widgetPosition.bottom = parseInt(panel.style.bottom) || 140;
        
        widget.style.left = widgetPosition.left + 'px';
        widget.style.bottom = widgetPosition.bottom + 'px';
        
        // Update widget avatar
        if (state.selectedEntities.length > 0) {
            const ent = state.selectedEntities[0];
            const widgetAvatar = document.getElementById('widget-avatar');
            widgetAvatar.innerText = '👤'; // You could use a custom emoji per character
        }
        
        widget.classList.remove('hidden');
        panel.classList.add('hidden');
        isInspectMinimized = true;
    }
};

// Setup widget dragging
function setupWidgetDragging() {
    const widget = document.getElementById('inspect-widget');
    
    widget.addEventListener('mousedown', (e) => {
        if (e.target.closest('.minimize-btn')) return;
        isDraggingWidget = true;
        const rect = widget.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.bottom;
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Click on widget to expand
    widget.addEventListener('click', (e) => {
        if (!isDraggingWidget) {
            toggleInspectPanel();
        }
    });
}

// Setup panel dragging
function setupPanelDragging() {
    const panel = document.getElementById('inspect-panel');
    
    panel.addEventListener('mousedown', (e) => {
        if (e.target.closest('.minimize-btn')) return;
        if (e.target.tagName === 'BUTTON') return; // Don't drag when clicking on buttons
        isDraggingPanel = true;
        const rect = panel.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.bottom;
        e.preventDefault();
        e.stopPropagation();
    });
}

// Global mousemove for both widget and panel
window.addEventListener('mousemove', (e) => {
    if (isDraggingWidget) {
        const widget = document.getElementById('inspect-widget');
        const widgetRect = widget.getBoundingClientRect();
        const widgetWidth = widgetRect.width || 60;
        const widgetHeight = widgetRect.height || 60;
        
        // Calculate new position
        let newLeft = e.clientX - dragOffset.x;
        let newBottom = window.innerHeight - e.clientY + dragOffset.y;
        
        // Constrain to screen bounds
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - widgetWidth));
        newBottom = Math.max(0, Math.min(newBottom, window.innerHeight - widgetHeight));
        
        widgetPosition.left = newLeft;
        widgetPosition.bottom = newBottom;
        
        widget.style.left = widgetPosition.left + 'px';
        widget.style.bottom = widgetPosition.bottom + 'px';
    }
    
    if (isDraggingPanel) {
        const panel = document.getElementById('inspect-panel');
        const panelRect = panel.getBoundingClientRect();
        const panelWidth = panelRect.width || 340;
        const panelHeight = panelRect.height || 200;
        
        // Calculate new position
        let newLeft = e.clientX - dragOffset.x;
        let newBottom = window.innerHeight - e.clientY + dragOffset.y;
        
        // Constrain to screen bounds
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panelWidth));
        newBottom = Math.max(0, Math.min(newBottom, window.innerHeight - panelHeight));
        
        panel.style.left = newLeft + 'px';
        panel.style.bottom = newBottom + 'px';
        widgetPosition.left = newLeft;
        widgetPosition.bottom = newBottom;
    }
});

// Global mouseup
window.addEventListener('mouseup', () => {
    isDraggingWidget = false;
    isDraggingPanel = false;
});

// Call setups after DOM loads
setupWidgetDragging();
setupPanelDragging();

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
    else if (e.code === 'KeyV') setOrder('mine');
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
}

window.addEventListener('mousemove', (e) => {
    if (state.camera.isDragging) {
        state.camera.x += (e.clientX - state.camera.lastMouseX) / state.camera.zoom;
        state.camera.y += (e.clientY - state.camera.lastMouseY) / state.camera.zoom;
    }
    if (state.selectionBox.active) { state.selectionBox.endX = e.clientX; state.selectionBox.endY = e.clientY; }
    if (state.mineSelection.active) {
        state.mineSelection.endX = e.clientX;
        state.mineSelection.endY = e.clientY;
    }
    if (state.chopSelection.active) {
        state.chopSelection.endX = e.clientX;
        state.chopSelection.endY = e.clientY;
    }
    if (state.isPainting) { tryPlaceJob(e.clientX, e.clientY); }
    
    // Custom cursor logic
    const customCursor = document.getElementById('custom-cursor');
    customCursor.style.left = e.clientX + 'px';
    customCursor.style.top = e.clientY + 'px';
    
    // Temporarily hide cursor to get correct elements from point
    customCursor.style.visibility = 'hidden';
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    customCursor.style.visibility = 'visible';
    const isOverCanvas = elements.some(el => el === canvas);
    const isOverUI = elements.some(el => 
        el.id === 'hud-right' || 
        el.id === 'time-container' || 
        el.id === 'bottom-menu' || 
        el.id === 'character-menu' || 
        el.id === 'inspect-panel' || 
        el.id === 'regen-btn' || 
        el.id === 'architect-menu' ||
        el.id === 'debug-time-panel' ||
        el.id === 'action-panel' ||
        el.closest('#hud-right') ||
        el.closest('#time-container') ||
        el.closest('#bottom-menu') ||
        el.closest('#character-menu') ||
        el.closest('#inspect-panel') ||
        el.closest('#regen-btn') ||
        el.closest('#architect-menu') ||
        el.closest('#debug-time-panel') ||
        el.closest('#action-panel') ||
        el.tagName === 'BUTTON'
    );
    
    // Reset all cursor classes
    customCursor.classList.remove('cursor-default', 'cursor-select', 'cursor-chop', 'cursor-mine');
    
    if (isOverUI) {
        // Select cursor for UI/buttons
        customCursor.style.backgroundImage = 'url(assets/select.png)';
        customCursor.classList.add('cursor-select');
        customCursor.style.display = 'block';
    } else if (isOverCanvas) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const tx = Math.floor(worldPos.x / state.map.tileSize);
        const ty = Math.floor(worldPos.y / state.map.tileSize);
        
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            const tile = state.map.tiles[ty][tx];
            
            if (tile.type === TILE_TYPES.TREE) {
                // Chop cursor for trees
                customCursor.style.backgroundImage = 'url(assets/chop.png)';
                customCursor.classList.add('cursor-chop');
                customCursor.style.display = 'block';
            } else if (tile.type === TILE_TYPES.STONE || tile.type === TILE_TYPES.GOLD_ORE || 
                       tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_ROCK_DARK || 
                       tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                // Mine cursor for stones/ores
                customCursor.style.backgroundImage = 'url(assets/mine.png)';
                customCursor.classList.add('cursor-mine');
                customCursor.style.display = 'block';
            } else {
                // Default cursor
                customCursor.style.backgroundImage = 'url(assets/cursor.png)';
                customCursor.classList.add('cursor-default');
                customCursor.style.display = 'block';
            }
        } else {
            // Default cursor
            customCursor.style.backgroundImage = 'url(assets/cursor.png)';
            customCursor.classList.add('cursor-default');
            customCursor.style.display = 'block';
        }
    } else {
        // Hide custom cursor when outside window
        customCursor.style.display = 'none';
    }
    
    state.camera.lastMouseX = e.clientX; state.camera.lastMouseY = e.clientY;
});

window.addEventListener('mouseup', (e) => {
    state.isPainting = false;
    state.lastPaintedTile = null; // Reset after painting is done
    if (state.selectionBox.active && e.button === 0) {
        state.selectionBox.endX = e.clientX; state.selectionBox.endY = e.clientY;
        if (Math.abs(state.selectionBox.endX - state.selectionBox.startX) > 5 || Math.abs(state.selectionBox.endY - state.selectionBox.startY) > 5) selectEntitiesInBox();
        state.selectionBox.active = false;
    }
    if (state.mineSelection.active && e.button === 0) {
        state.mineSelection.endX = e.clientX;
        state.mineSelection.endY = e.clientY;

        const startWorld = screenToWorld(state.mineSelection.startX, state.mineSelection.startY);
        const endWorld = screenToWorld(state.mineSelection.endX, state.mineSelection.endY);

        const minTX = Math.floor(Math.min(startWorld.x, endWorld.x) / state.map.tileSize);
        const maxTX = Math.floor(Math.max(startWorld.x, endWorld.x) / state.map.tileSize);
        const minTY = Math.floor(Math.min(startWorld.y, endWorld.y) / state.map.tileSize);
        const maxTY = Math.floor(Math.max(startWorld.y, endWorld.y) / state.map.tileSize);

        const isSingleClick = Math.abs(state.mineSelection.endX - state.mineSelection.startX) < 5 && 
                             Math.abs(state.mineSelection.endY - state.mineSelection.startY) < 5;

        for (let ty = Math.max(0, minTY); ty <= Math.min(state.map.height - 1, maxTY); ty++) {
            for (let tx = Math.max(0, minTX); tx <= Math.min(state.map.width - 1, maxTX); tx++) {
                const tile = state.map.tiles[ty][tx];
                if (tile.type === TILE_TYPES.STONE || tile.type === TILE_TYPES.GOLD_ORE || tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                    const existingJobIndex = state.jobs.findIndex(j => j.x === tx && j.y === ty && j.type === 'mine');
                    if (existingJobIndex !== -1) {
                        const removedJob = state.jobs[existingJobIndex];
                        state.jobs.splice(existingJobIndex, 1);
                        state.entities.forEach(ent => {
                            if (ent.job === removedJob) {
                                ent.job = null;
                            }
                        });
                    } else {
                        let resource;
                        if (tile.type === TILE_TYPES.GOLD_ORE) {
                            resource = 'gold';
                        } else if (tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_ROCK_DARK || tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                            resource = 'mountain';
                        } else {
                            resource = 'stone';
                        }
                        const newJob = { id: state.nextJobId++, type: 'mine', x: tx, y: ty, progress: 0, assigned: false, resource: resource };
                        state.jobs.push(newJob);
                        state.selectedEntities.forEach(ent => {
                            if (!ent.taskQueue) ent.taskQueue = [];
                            if (!ent.job) {
                                assignJobToEntity(ent, newJob);
                            } else {
                                ent.taskQueue.push(newJob);
                            }
                        });
                    }
                }
            }
        }
        
        state.mineSelection.active = false;
        updateActionPanel();
    }
    if (state.chopSelection.active && e.button === 0) {
        state.chopSelection.endX = e.clientX;
        state.chopSelection.endY = e.clientY;

        const startWorld = screenToWorld(state.chopSelection.startX, state.chopSelection.startY);
        const endWorld = screenToWorld(state.chopSelection.endX, state.chopSelection.endY);

        const minTX = Math.floor(Math.min(startWorld.x, endWorld.x) / state.map.tileSize);
        const maxTX = Math.floor(Math.max(startWorld.x, endWorld.x) / state.map.tileSize);
        const minTY = Math.floor(Math.min(startWorld.y, endWorld.y) / state.map.tileSize);
        const maxTY = Math.floor(Math.max(startWorld.y, endWorld.y) / state.map.tileSize);

        for (let ty = Math.max(0, minTY); ty <= Math.min(state.map.height - 1, maxTY); ty++) {
            for (let tx = Math.max(0, minTX); tx <= Math.min(state.map.width - 1, maxTX); tx++) {
                const tile = state.map.tiles[ty][tx];
                if (tile.type === TILE_TYPES.TREE) {
                    const existingJobIndex = state.jobs.findIndex(j => j.x === tx && j.y === ty && j.type === 'chop');
                    if (existingJobIndex !== -1) {
                        const removedJob = state.jobs[existingJobIndex];
                        state.jobs.splice(existingJobIndex, 1);
                        state.entities.forEach(ent => {
                            if (ent.job === removedJob) {
                                ent.job = null;
                            }
                        });
                    } else {
                        const newJob = { id: state.nextJobId++, type: 'chop', x: tx, y: ty, progress: 0, assigned: false };
                        state.jobs.push(newJob);
                        state.selectedEntities.forEach(ent => {
                            if (!ent.taskQueue) ent.taskQueue = [];
                            if (!ent.job) {
                                assignJobToEntity(ent, newJob);
                            } else {
                                ent.taskQueue.push(newJob);
                            }
                        });
                    }
                }
            }
        }
        
        state.chopSelection.active = false;
        updateActionPanel();
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
    if (!job) return;
    
    if (ent.job) {
        // If the job is build/destruct, unassign it
        if (ent.job.type === 'build_wall' || ent.job.type === 'build_wood_wall' || ent.job.type === 'build_bridge' || ent.job.type === 'destruct') {
            ent.job.assigned = false;
        }
    }
    ent.job = job; 
    // Mark all jobs as assigned so unselected characters don't grab them
    job.assigned = true;
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
            // Don't let unselected characters automatically grab jobs
            // Only work on jobs that were explicitly assigned to them
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
                
                const nextX = ent.x + (dx / dist) * ent.speed * speedMult;
                const nextY = ent.y + (dy / dist) * ent.speed * speedMult;
                const nextTX = Math.floor(nextX);
                const nextTY = Math.floor(nextY);
                
                // Only check occupancy if moving to a DIFFERENT tile than current
                if (nextTX !== Math.floor(ent.x) || nextTY !== Math.floor(ent.y)) {
                    if (isTileOccupied(nextTX, nextTY, ent)) {
                        // If it's a manual move or a job, we wait. 
                        // If it's just wandering, we might want to cancel.
                        return; 
                    }
                }
                
                ent.x = nextX; ent.y = nextY;
            }
        } else if (ent.job) {
                // Проверяем, что job ещё существует и не null
                if (!ent.job) return;
                
                // Check distance to job (allow working within 1 cell)
                const dx = (ent.job.x + 0.5) - ent.x; 
                const dy = (ent.job.y + 0.5) - ent.y;
                const distToJob = Math.sqrt(dx * dx + dy * dy);
                
                if (distToJob < 1.5) { // Allow working within ~1.5 cells (adjacent or on top)
                    // Calculate progress bonus based on number of workers on the same job
                    let workerBonus = 1;
                    let workersOnSameJob = 0;
                    
                    state.entities.forEach(e => {
                        if (e !== ent && e.job && e.job.id === ent.job.id) {
                            workersOnSameJob++;
                        }
                    });
                    
                    if (workersOnSameJob === 1) workerBonus = 1.15; // +15% for 2 workers
                    else if (workersOnSameJob >= 2) workerBonus = 1.25; // +25% for 3+ workers
                    
                    // Calculate mining speed based on tile type
                    let miningSpeed = 0.5 * workerBonus;
                    
                    // Проверка, что job ещё существует перед доступом к его свойствам
                    if (!ent.job) return;
                    
                    const tile = state.map.tiles[ent.job.y][ent.job.x];
                    if (tile.type === TILE_TYPES.MOUNTAIN_ROCK || tile.type === TILE_TYPES.MOUNTAIN_SNOW) {
                        miningSpeed /= 10; // Mountain rock/snow is 10x slower
                    }
                    
                    ent.job.progress += miningSpeed; 
                    
                    if (ent.job.progress >= 100) {
                        const job = ent.job; const tx = job.x; const ty = job.y;
                        if (job.type === 'build_wall') state.map.tiles[ty][tx].type = TILE_TYPES.WALL;
                        else if (job.type === 'build_wood_wall') state.map.tiles[ty][tx].type = TILE_TYPES.WOOD_WALL;
                        else if (job.type === 'build_bridge') state.map.tiles[ty][tx].type = TILE_TYPES.BRIDGE;
                        else if (job.type === 'mine') { 
                            state.map.tiles[ty][tx].type = TILE_TYPES.SOIL; 
                            
                            if (job.resource === 'gold') {
                                // Gold ore gives gold + small stone
                                const goldGain = Math.floor(Math.random() * 10) + 20; 
                                const stoneFromGoldGain = Math.floor(Math.random() * 8) + 10; // 10-17 stone
                                state.resources.gold += goldGain; 
                                state.resources.stone += stoneFromGoldGain;
                            } else if (job.resource === 'mountain') {
                                // Mountain rock gives stone + small chance of gold
                                const stoneGain = Math.floor(Math.random() * 10) + 50;
                                state.resources.stone += stoneGain;
                                // 8% chance to get gold from mountain rock (less than gold ore)
                                if (Math.random() < 0.08) {
                                    const goldGain = Math.floor(Math.random() * 3) + 2; // Less gold than gold ore
                                    state.resources.gold += goldGain;
                                }
                            } else {
                                // Regular stone gives more stone
                                const stoneGain = Math.floor(Math.random() * 16) + 81;
                                state.resources.stone += stoneGain; 
                            }
                            updateResourceUI(); 
                        }
                        else if (job.type === 'chop') {
                            state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                            const woodGain = Math.floor(Math.random() * 16) + 81;
                            state.resources.wood += woodGain;
                            updateResourceUI();
                        }
                        else if (job.type === 'destruct') {
                            if (state.map.tiles[ty][tx].type === TILE_TYPES.BRIDGE) {
                                state.map.tiles[ty][tx].type = TILE_TYPES.WATER;
                                state.resources.wood += 5;
                            } else if (state.map.tiles[ty][tx].type === TILE_TYPES.WOOD_WALL) {
                                state.map.tiles[ty][tx].type = TILE_TYPES.GRASS;
                                state.resources.wood += 4;
                            } else {
                                state.map.tiles[ty][tx].type = TILE_TYPES.SOIL;
                                state.resources.stone += 6; 
                            }
                            updateResourceUI();
                        }
                        state.map.chunks[Math.floor(ty / state.map.chunkSize)][Math.floor(tx / state.map.chunkSize)].dirty = true;
                        state.jobs = state.jobs.filter(j => j !== job);
                        
                        // Clear job from all entities that were working on it
                        state.entities.forEach(e => {
                            if (e.job === job) {
                                e.job = null;
                                // Assign next task from queue for each
                                if (e.taskQueue && e.taskQueue.length > 0) {
                                    const nextJob = e.taskQueue.shift();
                                    if (nextJob) {
                                        assignJobToEntity(e, nextJob);
                                    }
                                }
                            }
                        });
                        
                        updateActionPanel();
                    }
                } else if (!ent.target && ent.job) assignJobToEntity(ent, ent.job);
            } else if (Math.random() < 0.005) {
            let tx, ty;
            if (Math.random() < 0.7) {
                for (let attempt = 0; attempt < 10; attempt++) {
                    const rx = Math.floor(ent.x + (Math.random() * 20 - 10));
                    const ry = Math.floor(ent.y + (Math.random() * 20 - 10));
                    if (isWalkable(rx, ry) && !isTileOccupied(rx, ry, ent)) {
                        tx = rx; ty = ry;
                        break;
                    }
                }
            } else {
                const other = state.entities.find(e => e !== ent && Math.sqrt(Math.pow(e.x - ent.x, 2) + Math.pow(e.y - ent.y, 2)) < 30);
                if (other) {
                    // Try to find a free tile near the other entity
                    for (let attempt = 0; attempt < 10; attempt++) {
                        const rx = Math.floor(other.x + (Math.random() * 3 - 1));
                        const ry = Math.floor(other.y + (Math.random() * 3 - 1));
                        if (isWalkable(rx, ry) && !isTileOccupied(rx, ry, ent)) {
                            tx = rx; ty = ry;
                            break;
                        }
                    }
                }
            }

            if (tx !== undefined && ty !== undefined && isWalkable(tx, ty) && !isTileOccupied(tx, ty, ent)) {
                if (isPathClearOfWater(ent.x, ent.y, tx, ty)) { 
                    ent.path = [{ x: tx + 0.5, y: ty + 0.5 }]; 
                    ent.target = ent.path[0]; 
                } else { 
                    const path = findPath(ent.x, ent.y, tx, ty); 
                    if (path) { ent.path = path; ent.target = path[0]; } 
                }
            }
        }
    });
}

function updateTimeUI() {
    const timeDisplay = document.getElementById('time');
    const sunIcon = document.getElementById('time-icon-sun');
    const moonIcon = document.getElementById('time-icon-moon');
    if (!timeDisplay) return;
    timeDisplay.innerText = `Day ${state.time.day}, ${String(state.time.hour).padStart(2, '0')}:${String(state.time.minute).padStart(2, '0')}`;
    
    if (sunIcon && moonIcon) {
        if (state.time.hour >= 6 && state.time.hour < 18) {
            sunIcon.classList.add('active');
            moonIcon.classList.remove('active');
        } else {
            sunIcon.classList.remove('active');
            moonIcon.classList.add('active');
        }
    }
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
    
    if (state.currentOrder === 'architect' || state.currentOrder === 'bridge' || state.currentOrder === 'unarchitect' || state.currentOrder === 'mine' || state.currentOrder === 'chop') {
        const mouseWorld = screenToWorld(state.camera.lastMouseX, state.camera.lastMouseY);
        const tx = Math.floor(mouseWorld.x / state.map.tileSize);
        const ty = Math.floor(mouseWorld.y / state.map.tileSize);
        if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
            const tile = state.map.tiles[ty][tx];
            if ((state.currentOrder === 'architect' && tile.type !== TILE_TYPES.STONE) || 
                (state.currentOrder === 'bridge' && tile.type !== TILE_TYPES.STONE) ||
                state.currentOrder === 'mine' || state.currentOrder === 'chop' || 
                state.currentOrder === 'unarchitect') {
                if (state.currentOrder === 'architect') {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                } else if (state.currentOrder === 'bridge') {
                    ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
                } else if (state.currentOrder === 'mine') {
                    ctx.fillStyle = 'rgba(255, 165, 0, 0.3)';
                } else if (state.currentOrder === 'chop') {
                    ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
                } else {
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                }
                ctx.fillRect(tx * state.map.tileSize, ty * state.map.tileSize, state.map.tileSize, state.map.tileSize);
            }
        }
    }
    drawFogOfWar();
    state.jobs.forEach(job => {
        if (job.type === 'build_wall') {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        } else if (job.type === 'build_bridge') {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(139, 69, 19, 0.5)';
        } else if (job.type === 'mine') {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(255, 165, 0, 0.5)';
        } else if (job.type === 'chop') {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(139, 69, 19, 0.5)';
        } else {
            ctx.setLineDash([2, 2]);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        }
        ctx.strokeRect(job.x * state.map.tileSize + 2, job.y * state.map.tileSize + 2, state.map.tileSize - 4, state.map.tileSize - 4);
        ctx.setLineDash([]);
        if (job.progress > 0) {
            if (job.type === 'build_wall') {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            } else if (job.type === 'build_bridge') {
                ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
            } else if (job.type === 'mine') {
                ctx.fillStyle = 'rgba(255, 165, 0, 0.3)';
            } else if (job.type === 'chop') {
                ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
            } else {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            }
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
                const crossSize = state.map.tileSize / 6;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = 2 / state.camera.zoom;
                const px = lastPoint.x * state.map.tileSize;
                const py = lastPoint.y * state.map.tileSize;
                ctx.beginPath();
                ctx.moveTo(px - crossSize, py - crossSize);
                ctx.lineTo(px + crossSize, py + crossSize);
                ctx.moveTo(px + crossSize, py - crossSize);
                ctx.lineTo(px - crossSize, py + crossSize);
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
        ctx.strokeStyle = '#c5a455';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(minX, minY, width, height);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(197, 164, 85, 0.06)';
        ctx.fillRect(minX, minY, width, height);
        ctx.strokeStyle = 'rgba(197, 164, 85, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(minX + 1, minY + 1, width - 2, height - 2);
    }
    if (state.mineSelection.active) {
        const minX = Math.min(state.mineSelection.startX, state.mineSelection.endX);
        const minY = Math.min(state.mineSelection.startY, state.mineSelection.endY);
        const width = Math.abs(state.mineSelection.endX - state.mineSelection.startX);
        const height = Math.abs(state.mineSelection.endY - state.mineSelection.startY);
        
        ctx.strokeStyle = '#a72929';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(minX, minY, width, height);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(167, 41, 41, 0.1)';
        ctx.fillRect(minX, minY, width, height);
        ctx.strokeStyle = 'rgba(167, 41, 41, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(minX + 1, minY + 1, width - 2, height - 2);
    }
    if (state.chopSelection.active) {
        const minX = Math.min(state.chopSelection.startX, state.chopSelection.endX);
        const minY = Math.min(state.chopSelection.startY, state.chopSelection.endY);
        const width = Math.abs(state.chopSelection.endX - state.chopSelection.startX);
        const height = Math.abs(state.chopSelection.endY - state.chopSelection.startY);
        
        ctx.strokeStyle = '#5ecfff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(minX, minY, width, height);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(94, 207, 255, 0.1)';
        ctx.fillRect(minX, minY, width, height);
        ctx.strokeStyle = 'rgba(94, 207, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(minX + 1, minY + 1, width - 2, height - 2);
    }
    
    update();
        updateActionPanel(); // Update task panel
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
    state.lastPaintedTile = null; // Reset when order changes

    if (type === 'architect') {
        // Toggle architect menu
        const menu = document.getElementById('architect-menu');
        if (state.currentOrder === 'architect') {
            state.currentOrder = null;
            menu.classList.add('hidden');
        } else {
            state.currentOrder = 'architect';
            menu.classList.remove('hidden');
        }
    } else {
        // Hide architect menu for other orders
        document.getElementById('architect-menu').classList.add('hidden');
        if (state.currentOrder === type) state.currentOrder = null;
        else state.currentOrder = type;
    }
    
    const orderNames = { 'architect': 'Architect', 'unarchitect': 'Destruct', 'chop': 'Chop', 'mine': 'Mine' };
    const buttons = document.querySelectorAll('#bottom-menu button');
    buttons.forEach(btn => {
        if (orderNames[type] === btn.innerText) btn.style.background = state.currentOrder === type ? '#555' : '#333';
        else btn.style.background = '#333';
    });
};

window.setBuildOrder = function(buildType) {
    state.lastPaintedTile = null;
    document.getElementById('architect-menu').classList.add('hidden');
    
    // Set the build order
    if (buildType === 'bridge') {
        state.currentOrder = 'bridge';
    } else if (buildType === 'stone_wall') {
        state.currentOrder = 'architect';
        // We'll use a special state to track we're building stone walls
        state.buildType = 'stone_wall';
    } else if (buildType === 'wood_wall') {
        state.currentOrder = 'architect';
        state.buildType = 'wood_wall';
    }
    
    // Update button states
    const buttons = document.querySelectorAll('#bottom-menu button');
    buttons.forEach(btn => {
        btn.style.background = '#333';
    });
    // Highlight Architect button
    buttons.forEach(btn => {
        if (btn.innerText === 'Architect') btn.style.background = '#555';
    });
};

function getJobTypeName(job) {
    switch (job.type) {
        case 'mine': 
            if (job.resource === 'gold') return 'Добыча золота';
            if (job.resource === 'mountain') return 'Добыча горной породы';
            return 'Добыча камня';
        case 'chop': return 'Рубка леса';
        case 'build_wall': return 'Строительство каменной стены';
        case 'build_wood_wall': return 'Строительство деревянной стены';
        case 'build_bridge': return 'Строительство моста';
        case 'destruct': return 'Разрушение';
        default: return 'Задание';
    }
}

// Initialize event delegation
function initCancelButtons() {
    console.log('Initializing cancel button listeners...');
    const actionList = document.getElementById('action-list');
    if (!actionList) {
        console.log('ERROR: action-list not found!');
        return;
    }
    
    console.log('action-list found! Adding listeners...');
    
    // Global click listener
    actionList.addEventListener('click', (e) => {
        console.log('=== action-list CLICK ===');
        console.log('Target:', e.target);
        
        const cancelBtn = e.target.closest('.cancel-task-btn');
        if (cancelBtn) {
            console.log('Cancel button found!');
            e.stopPropagation();
            e.preventDefault();
            
            const entityId = parseInt(cancelBtn.getAttribute('data-entity-id'));
            const jobId = parseInt(cancelBtn.getAttribute('data-job-id'));
            console.log('Calling cancelTask with:', entityId, jobId);
            
            cancelTask(entityId, jobId);
        }
    });
    
    actionList.addEventListener('mousedown', (e) => {
        console.log('=== action-list MOUSEDOWN ===');
        console.log('Target:', e.target);
    });
    
    console.log('Cancel button listeners initialized!');
}

// Global debug listener for all clicks
document.addEventListener('mousedown', (e) => {
    console.log('=== GLOBAL MOUSEDOWN ===');
    console.log('Target:', e.target);
    console.log('Element:', e.target.closest('.cancel-task-btn'));
    
    // Temporarily hide cursor to get correct element from point
    const customCursor = document.getElementById('custom-cursor');
    if (customCursor) {
        customCursor.style.visibility = 'hidden';
        console.log('Element from point:', document.elementFromPoint(e.clientX, e.clientY));
        customCursor.style.visibility = 'visible';
    } else {
        console.log('Element from point:', document.elementFromPoint(e.clientX, e.clientY));
    }
});

// Initialize immediately
setTimeout(initCancelButtons, 100);

function updateActionPanel() {
    const actionList = document.getElementById('action-list');
    const cancelAllBtn = document.getElementById('cancel-all-btn');
    if (!actionList || !cancelAllBtn) return;

    let hasTasks = false;
    let html = '';

    state.entities.forEach(ent => {
        // Add current job
        if (ent.job) {
            hasTasks = true;
            html += `<div class="action-item">
                <div class="action-content">
                    <div class="action-character">${ent.name}</div>
                    <div class="action-status">${getJobTypeName(ent.job)} (${Math.floor(ent.job.progress)}%)</div>
                </div>
                <button class="cancel-task-btn" data-job-id="${ent.job.id}" data-entity-id="${ent.id}" title="Отменить">✕</button>
            </div>`;
        }

        // Add queued jobs
        if (ent.taskQueue) {
            ent.taskQueue.forEach(job => {
                hasTasks = true;
                html += `<div class="action-item">
                    <div class="action-content">
                        <div class="action-character">${ent.name}</div>
                        <div class="action-status">${getJobTypeName(job)} (Ожидание...)</div>
                    </div>
                    <button class="cancel-task-btn" data-job-id="${job.id}" data-entity-id="${ent.id}" title="Отменить">✕</button>
                </div>`;
            });
        }
    });

    actionList.innerHTML = html;
    cancelAllBtn.disabled = !hasTasks;
}

window.cancelTask = function(entityId, jobId) {
    console.log('=== cancelTask START ===');
    console.log('Input:', entityId, jobId);
    
    const ent = state.entities.find(e => e.id === entityId);
    if (!ent) {
        console.log('ERROR: Entity not found!');
        return;
    }
    console.log('Found entity:', ent.name);

    // Cancel current job
    if (ent.job && ent.job.id === jobId) {
        console.log('Canceling CURRENT job:', ent.job);
        
        // Refund if needed
        if (ent.job.type === 'build_wall') state.resources.stone += 12;
        if (ent.job.type === 'build_wood_wall') state.resources.wood += 8;
        if (ent.job.type === 'build_bridge') state.resources.wood += 10;
        
        // Clear everything
        ent.job.assigned = false;
        ent.job = null;
        ent.status = null;
        ent.target = null;
        ent.path = [];
        ent.isManualMove = false;
        
        updateResourceUI();
        
        // Next job
        if (ent.taskQueue && ent.taskQueue.length > 0) {
            const nextJob = ent.taskQueue.shift();
            console.log('Next job from queue:', nextJob);
            assignJobToEntity(ent, nextJob);
        }
    }
    // Cancel queued job
    else if (ent.taskQueue) {
        const queueIndex = ent.taskQueue.findIndex(j => j.id === jobId);
        if (queueIndex !== -1) {
            console.log('Canceling QUEUED job at index:', queueIndex);
            const removedJob = ent.taskQueue.splice(queueIndex, 1)[0];
            removedJob.assigned = false;
            
            if (removedJob.type === 'build_wall') state.resources.stone += 12;
            if (removedJob.type === 'build_wood_wall') state.resources.wood += 8;
            if (removedJob.type === 'build_bridge') state.resources.wood += 10;
            
            updateResourceUI();
        }
    }
    
    state.jobs = state.jobs.filter(j => j.id !== jobId);
    console.log('Removed job from state.jobs');
    
    updateActionPanel();
    console.log('=== cancelTask END ===');
};

window.cancelAllTasks = function() {
    state.entities.forEach(ent => {
        // Cancel current job
        if (ent.job) {
            // Refund resources if needed
            if (ent.job.type === 'build_wall') {
                state.resources.stone += 12;
            } else if (ent.job.type === 'build_wood_wall') {
                state.resources.wood += 8;
            } else if (ent.job.type === 'build_bridge') {
                state.resources.wood += 10;
            }

            ent.job.assigned = false;
            ent.job = null;
            ent.status = null;
            ent.target = null;
            ent.path = [];
            ent.isManualMove = false;
        }

        // Clear task queue
        if (ent.taskQueue) {
            ent.taskQueue.forEach(job => {
                // Refund resources for queued jobs
                if (job.type === 'build_wall') {
                    state.resources.stone += 12;
                } else if (job.type === 'build_wood_wall') {
                    state.resources.wood += 8;
                } else if (job.type === 'build_bridge') {
                    state.resources.wood += 10;
                }
                job.assigned = false;
            });
            ent.taskQueue = [];
        }
    });

    // Clear all jobs (except maybe unassigned? Wait, but all assigned were processed)
    state.jobs = [];
    updateResourceUI();
    updateActionPanel();
};

window.addEventListener('resize', resize);
resize(); initMap(); initEntities();
// Инициализируем предыдущие значения
state.prevResources = {
    silver: state.resources.silver,
    stone: state.resources.stone,
    wood: state.resources.wood,
    food: state.resources.food,
    gold: state.resources.gold
};
// Заполняем контейнеры без анимации
['silver', 'stone', 'wood', 'gold', 'food'].forEach(name => {
    const containerId = `${name}-count`;
    const container = document.getElementById(containerId);
    if (container) {
        const value = state.resources[name] || 0;
        const valueStr = value.toString();
        container.innerHTML = '';
        for (let i = 0; i < valueStr.length; i++) {
            const digitEl = document.createElement('div');
            digitEl.className = 'counter-digit';
            digitEl.textContent = valueStr[i];
            container.appendChild(digitEl);
        }
    }
});
state.map.chunks.forEach(row => row.forEach(c => c.dirty = true));
requestAnimationFrame(render);
