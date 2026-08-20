/*
 * SPDX-License-Identifier: GPL-3.0-or-later
*/

import "./style.css";

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, ContextMenuApi, FluxDispatcher, Forms, Menu, React, SelectedChannelStore, UserStore } from "@webpack/common";

type AnyMessage = {
    guild_id?: string;
    channel_id?: string;
    attachments?: Array<{ url?: string; proxy_url?: string; content_type?: string; filename?: string; width?: number; height?: number; }>;
    embeds?: Array<{ image?: { url?: string; proxyURL?: string; proxy_url?: string; }; thumbnail?: { url?: string; proxyURL?: string; proxy_url?: string; }; }>;
};

type Layer =
    | { id: string; type: "text"; label: string; value: string; x: number; y: number; scale: number; rotation: number; color: string; fontSize: number; }
    | { id: string; type: "avatar"; label: string; value: string; image: HTMLImageElement; x: number; y: number; scale: number; rotation: number; size: number; shape: "circle" | "square"; };

type GuildUser = { id: string; name: string; username: string; handle: string; nick?: string; avatar: string; };
type LayerBounds = { width: number; height: number; };
type HandleName = "delete" | "scale" | "rotate";

const GuildMemberStore = findByPropsLazy("getMember", "getMembers");
const MAX_UPLOAD_BYTES = 9.5 * 1024 * 1024;
let imageContextMenuListener: ((event: MouseEvent) => void) | undefined;

function getImageUrl(message?: AnyMessage) {
    const attachment = message?.attachments?.find(a => {
        const type = a.content_type ?? "";
        const name = a.filename ?? "";
        return type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name);
    });

    if (attachment?.proxy_url || attachment?.url) return attachment.proxy_url ?? attachment.url;

    for (const embed of message?.embeds ?? []) {
        const image = embed.image?.proxyURL ?? embed.image?.proxy_url ?? embed.image?.url;
        const thumbnail = embed.thumbnail?.proxyURL ?? embed.thumbnail?.proxy_url ?? embed.thumbnail?.url;
        if (image || thumbnail) return image ?? thumbnail;
    }

    return undefined;
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

function getGuildId(message?: AnyMessage) {
    if (message?.guild_id) return message.guild_id;
    if (message?.channel_id) return ChannelStore.getChannel(message.channel_id)?.guild_id;
    return SelectedChannelStore.getGuildId?.();
}

function userToGuildUser(user: any, guildId?: string, nick?: string): GuildUser | null {
    if (!user) return null;
    const username = user.username ?? user.id;

    return {
        id: user.id,
        name: nick ?? user.globalName ?? username,
        username,
        handle: user.discriminator && user.discriminator !== "0"
            ? `${username}#${user.discriminator}`
            : `@${username}`,
        nick,
        avatar: user.getAvatarURL?.(guildId, 256, true) ?? user.getAvatarURL?.(undefined, 256, true)
    };
}

function getGuildUsers(guildId?: string) {
    if (!guildId) return [];

    const members = Object.values(GuildMemberStore.getMembers?.(guildId) ?? {}) as Array<{ userId?: string; nick?: string; }>;
    return members
        .map(member => {
            const user = UserStore.getUser(member.userId);
            return userToGuildUser(user, guildId, member.nick);
        })
        .filter(Boolean) as GuildUser[];
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Failed to export meme image")), type, quality);
    });
}

function drawCanvasToSize(source: HTMLCanvasElement, width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
    return canvas;
}

async function exportUploadBlob(canvas: HTMLCanvasElement) {
    const png = await canvasToBlob(canvas, "image/png");
    if (png.size <= MAX_UPLOAD_BYTES) {
        return { blob: png, filename: "meme-editor.png" };
    }

    let width = canvas.width;
    let height = canvas.height;
    let workingCanvas = canvas;

    for (const scale of [1, 0.85, 0.7, 0.55, 0.4, 0.3]) {
        width = Math.max(1, Math.round(canvas.width * scale));
        height = Math.max(1, Math.round(canvas.height * scale));
        workingCanvas = scale === 1 ? canvas : drawCanvasToSize(canvas, width, height);

        for (const quality of [0.92, 0.82, 0.72, 0.62, 0.52, 0.42]) {
            const jpeg = await canvasToBlob(workingCanvas, "image/jpeg", quality);
            if (jpeg.size <= MAX_UPLOAD_BYTES) {
                return { blob: jpeg, filename: "meme-editor.jpg" };
            }
        }
    }

    const smallest = drawCanvasToSize(canvas, width, height);
    return { blob: await canvasToBlob(smallest, "image/jpeg", 0.35), filename: "meme-editor.jpg" };
}

function focusChatInput() {
    const input = document.querySelector<HTMLElement>(
        "[data-slate-editor=\"true\"], [role=\"textbox\"][contenteditable=\"true\"], div[contenteditable=\"true\"]"
    );
    input?.focus();
}

async function pasteFileToCurrentChannel(file: File) {
    focusChatInput();

    const data = new DataTransfer();
    data.items.add(file);

    document.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data
    }));
}

function getTextWidth(layer: Extract<Layer, { type: "text"; }>, ctx?: CanvasRenderingContext2D | null) {
    const measuringContext = ctx ?? document.createElement("canvas").getContext("2d");
    if (!measuringContext) return layer.value.length * layer.fontSize * layer.scale * 0.58;

    const fontSize = layer.fontSize * layer.scale;
    measuringContext.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`;
    return measuringContext.measureText(layer.value).width;
}

function getLayerBounds(layer: Layer, ctx?: CanvasRenderingContext2D | null): LayerBounds {
    if (layer.type === "avatar") {
        const size = layer.size * layer.scale;
        return { width: size, height: size };
    }

    return {
        width: Math.max(120, getTextWidth(layer, ctx)),
        height: layer.fontSize * layer.scale * 1.25
    };
}

function getLayerBoundsForCanvas(layer: Layer) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    return getLayerBounds(layer, ctx);
}

function getHandlePositions(layer: Layer) {
    const bounds = getLayerBoundsForCanvas(layer);
    const half = Math.max(bounds.width, bounds.height) / 2;
    const pad = 34;
    const offset = half + pad;

    return {
        delete: { x: layer.x - offset, y: layer.y - offset },
        scale: { x: layer.x + offset, y: layer.y + offset },
        rotate: { x: layer.x + offset, y: layer.y - offset }
    };
}

function MemeEditorModal({ imageUrl, guildId, modalProps }: { imageUrl: string; guildId?: string; modalProps: any; }) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const stageInnerRef = React.useRef<HTMLDivElement>(null);
    const baseImageRef = React.useRef<HTMLImageElement | null>(null);
    const dragRef = React.useRef<
        | { mode: "move"; id: string; dx: number; dy: number; }
        | { mode: "scale"; id: string; startDistance: number; startScale: number; }
        | { mode: "rotate"; id: string; startAngle: number; startRotation: number; }
        | null
    >(null);

    const [ready, setReady] = React.useState(false);
    const [layers, setLayers] = React.useState<Layer[]>([]);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [userQuery, setUserQuery] = React.useState("");
    const [users, setUsers] = React.useState(() => getGuildUsers(guildId));
    const selected = layers.find(layer => layer.id === selectedId);
    const filteredUsers = React.useMemo(() => {
        const query = userQuery.trim().toLowerCase();
        if (!query) return users.slice(0, 24);

        return users
            .filter(user =>
                user.id.includes(query)
                || user.name.toLowerCase().includes(query)
                || user.username.toLowerCase().includes(query)
                || user.handle.toLowerCase().includes(query)
                || user.nick?.toLowerCase().includes(query)
            )
            .slice(0, 24);
    }, [userQuery, users]);

    const renderCanvas = React.useCallback(() => {
        const canvas = canvasRef.current;
        const base = baseImageRef.current;
        if (!canvas || !base) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

        for (const layer of layers) {
            ctx.save();
            ctx.translate(layer.x, layer.y);
            ctx.rotate(layer.rotation * Math.PI / 180);

            if (layer.type === "avatar") {
                const size = layer.size * layer.scale;
                if (layer.shape === "circle") {
                    ctx.beginPath();
                    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
                    ctx.clip();
                }
                ctx.drawImage(layer.image, -size / 2, -size / 2, size, size);
            } else {
                const fontSize = layer.fontSize * layer.scale;
                ctx.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.lineJoin = "round";
                ctx.strokeStyle = "#000";
                ctx.lineWidth = Math.max(4, fontSize * 0.12);
                ctx.fillStyle = layer.color;
                ctx.strokeText(layer.value, 0, 0);
                ctx.fillText(layer.value, 0, 0);
            }

            ctx.restore();
        }
    }, [layers]);

    React.useEffect(() => {
        let alive = true;
        loadImage(imageUrl).then(image => {
            if (!alive) return;
            baseImageRef.current = image;
            const canvas = canvasRef.current;
            if (canvas) {
                const maxSide = 1200;
                const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
                canvas.width = Math.round(image.naturalWidth * ratio);
                canvas.height = Math.round(image.naturalHeight * ratio);
            }
            setReady(true);
        });
        return () => { alive = false; };
    }, [imageUrl]);

    React.useEffect(() => renderCanvas(), [renderCanvas, ready]);

    React.useEffect(() => {
        if (!guildId) return;

        const query = userQuery.trim();
        if (!query) {
            setUsers(getGuildUsers(guildId));
            return;
        }

        const timeout = window.setTimeout(() => {
            FluxDispatcher.dispatch(/^\d{15,25}$/.test(query)
                ? { type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], userIds: [query] }
                : { type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], query, limit: 25 });

            window.setTimeout(() => setUsers(getGuildUsers(guildId)), 700);
        }, 250);

        return () => window.clearTimeout(timeout);
    }, [guildId, userQuery]);

    function addTextLayer() {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const id = `text-${Date.now()}`;
        const value = "NewText";
        setLayers(existing => [...existing, {
            id,
            type: "text",
            label: value,
            value,
            x: canvas.width / 2,
            y: canvas.height / 2,
            scale: 1,
            rotation: 0,
            color: "#ffffff",
            fontSize: 54
        }]);
        setSelectedId(id);
    }

    async function addAvatarLayer(user: GuildUser) {
        const canvas = canvasRef.current;
        if (!user || !canvas) return;

        const image = await loadImage(user.avatar);
        const id = `avatar-${Date.now()}`;
        setLayers(existing => [...existing, {
            id,
            type: "avatar",
            label: user.name,
            value: user.avatar,
            image,
            x: canvas.width / 2,
            y: canvas.height / 2,
            scale: 1,
            rotation: 0,
            size: Math.max(96, Math.min(canvas.width, canvas.height) * 0.18),
            shape: "circle"
        }]);
        setSelectedId(id);
    }

    function updateSelected(patch: Partial<Layer>) {
        if (!selectedId) return;
        setLayers(existing => existing.map(layer => layer.id === selectedId ? { ...layer, ...patch } as Layer : layer));
    }

    function canvasPoint(event: React.PointerEvent<Element>) {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (canvas.width / rect.width),
            y: (event.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    function pickLayer(x: number, y: number) {
        return [...layers].reverse().find(layer => {
                const bounds = getLayerBoundsForCanvas(layer);
            return x >= layer.x - bounds.width / 2
                && x <= layer.x + bounds.width / 2
                && y >= layer.y - bounds.height / 2
                && y <= layer.y + bounds.height / 2;
        });
    }

    function applyDrag(point: { x: number; y: number; }) {
        if (!dragRef.current) return;

        const drag = dragRef.current;
        setLayers(existing => existing.map(layer => {
            if (layer.id !== drag.id) return layer;

            if (drag.mode === "move") {
                return { ...layer, x: point.x - drag.dx, y: point.y - drag.dy };
            }

            if (drag.mode === "scale") {
                const distance = Math.max(1, Math.hypot(point.x - layer.x, point.y - layer.y));
                return { ...layer, scale: Math.min(8, Math.max(0.1, drag.startScale * distance / drag.startDistance)) };
            }

            const angle = Math.atan2(point.y - layer.y, point.x - layer.x) * 180 / Math.PI;
            return { ...layer, rotation: drag.startRotation + angle - drag.startAngle };
        }));
    }

    function canvasToCssPoint(x: number, y: number) {
        const canvas = canvasRef.current;
        if (!canvas) return { x, y };
        const rect = canvas.getBoundingClientRect();
        return {
            x: x * rect.width / canvas.width,
            y: y * rect.height / canvas.height
        };
    }

    function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>, handle: HandleName) {
        const selectedLayer = layers.find(layer => layer.id === selectedId);
        if (!selectedLayer || !canvasRef.current) return;

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);

        const point = canvasPoint(event as any);

        if (handle === "delete") {
            setLayers(existing => existing.filter(layer => layer.id !== selectedId));
            setSelectedId(null);
            dragRef.current = null;
            return;
        }

        if (handle === "scale") {
            dragRef.current = {
                mode: "scale",
                id: selectedLayer.id,
                startDistance: Math.max(1, Math.hypot(point.x - selectedLayer.x, point.y - selectedLayer.y)),
                startScale: selectedLayer.scale
            };
            return;
        }

        dragRef.current = {
            mode: "rotate",
            id: selectedLayer.id,
            startAngle: Math.atan2(point.y - selectedLayer.y, point.x - selectedLayer.x) * 180 / Math.PI,
            startRotation: selectedLayer.rotation
        };
    }

    function moveLayer(fromIndex: number, toIndex: number) {
        if (fromIndex === toIndex || toIndex < 0 || toIndex >= layers.length) return;

        setLayers(existing => {
            const next = [...existing];
            const [layer] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, layer);
            return next;
        });
    }

    const selectedBounds = selected ? getLayerBoundsForCanvas(selected) : undefined;
    const selectedBox = selected && selectedBounds ? {
        ...canvasToCssPoint(selected.x, selected.y),
        width: selectedBounds.width * ((canvasRef.current?.getBoundingClientRect().width ?? canvasRef.current?.width ?? 1) / (canvasRef.current?.width ?? 1)),
        height: selectedBounds.height * ((canvasRef.current?.getBoundingClientRect().height ?? canvasRef.current?.height ?? 1) / (canvasRef.current?.height ?? 1)),
        rotation: selected.rotation
    } : undefined;
    const selectedHandles = selected ? getHandlePositions(selected) : undefined;

    return (
        <ModalRoot {...modalProps} size={ModalSize.DYNAMIC} className="vc-meme-editor-modal">
            <ModalHeader>
                <Forms.FormTitle tag="h2">Meme Editor</Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-meme-editor">
                    <div className="vc-meme-editor-stage">
                        <div ref={stageInnerRef} className="vc-meme-editor-stage-inner">
                            <canvas
                                ref={canvasRef}
                                className="vc-meme-editor-canvas"
                                onPointerDown={event => {
                                    const point = canvasPoint(event);
                                    const layer = pickLayer(point.x, point.y);
                                    setSelectedId(layer?.id ?? null);
                                    dragRef.current = layer ? { mode: "move", id: layer.id, dx: point.x - layer.x, dy: point.y - layer.y } : null;
                                    if (layer) event.currentTarget.setPointerCapture(event.pointerId);
                                }}
                                onPointerMove={event => applyDrag(canvasPoint(event))}
                                onPointerUp={() => { dragRef.current = null; }}
                                onPointerLeave={() => { dragRef.current = null; }}
                            />
                            {selected && selectedBox && selectedHandles && (
                                <div className="vc-meme-editor-overlay">
                                    <div
                                        className="vc-meme-editor-selection"
                                        style={{
                                            left: selectedBox.x,
                                            top: selectedBox.y,
                                            width: selectedBox.width,
                                            height: selectedBox.height,
                                            transform: `translate(-50%, -50%) rotate(${selectedBox.rotation}deg)`
                                        }}
                                    />
                                    {(Object.entries(selectedHandles) as Array<[HandleName, { x: number; y: number; }]>).map(([name, point]) => {
                                        const cssPoint = canvasToCssPoint(point.x, point.y);
                                        return (
                                            <button
                                                key={name}
                                                className={`vc-meme-editor-handle vc-meme-editor-handle-${name}`}
                                                style={{ left: cssPoint.x, top: cssPoint.y }}
                                                onPointerDown={event => handlePointerDown(event, name)}
                                                onPointerMove={event => applyDrag(canvasPoint(event))}
                                                onPointerUp={() => { dragRef.current = null; }}
                                            >
                                                {name === "delete" ? "X" : name === "rotate" ? "R" : <span className="vc-meme-editor-scale-icon" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="vc-meme-editor-panel">
                        <div className="vc-meme-editor-row">
                            <span className="vc-meme-editor-label">Text / Emoji</span>
                            <Button onClick={addTextLayer}>Add Text</Button>
                        </div>
                        <div className="vc-meme-editor-row">
                            <span className="vc-meme-editor-label">Server Icon</span>
                            <input className="vc-meme-editor-input" value={userQuery} placeholder="name / @username / numeric ID" onChange={e => setUserQuery(e.currentTarget.value)} />
                            <div className="vc-meme-editor-user-list">
                                {filteredUsers.length === 0 && <div className="vc-meme-editor-empty">No cached users found</div>}
                                {filteredUsers.map(user => (
                                    <button key={user.id} className="vc-meme-editor-user" onClick={() => addAvatarLayer(user)}>
                                        <img src={user.avatar} />
                                        <span className="vc-meme-editor-layer-name">{user.name}</span>
                                        <span className="vc-meme-editor-user-id">{user.handle}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="vc-meme-editor-row">
                            <span className="vc-meme-editor-label">Layers</span>
                            <div className="vc-meme-editor-layer-list">
                                {layers.length === 0 && <div className="vc-meme-editor-empty">No layers yet</div>}
                                {layers.map((layer, index) => (
                                    <button
                                        key={layer.id}
                                        className="vc-meme-editor-layer"
                                        data-selected={layer.id === selectedId}
                                        draggable
                                        onClick={() => setSelectedId(layer.id)}
                                        onDragStart={event => {
                                            event.dataTransfer.setData("text/plain", String(index));
                                            event.dataTransfer.effectAllowed = "move";
                                        }}
                                        onDragOver={event => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "move";
                                        }}
                                        onDrop={event => {
                                            event.preventDefault();
                                            moveLayer(Number(event.dataTransfer.getData("text/plain")), index);
                                        }}
                                    >
                                        <span className="vc-meme-editor-layer-name">{layer.label}</span>
                                        <span>{layer.type}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        {selected && (
                            <div className="vc-meme-editor-row">
                                <span className="vc-meme-editor-label">Layer Options</span>
                                {selected.type !== "avatar" && (
                                    <>
                                        <input className="vc-meme-editor-input" value={selected.value} onChange={e => updateSelected({ value: e.currentTarget.value, label: e.currentTarget.value || "Text" })} />
                                        <input className="vc-meme-editor-input" type="color" value={selected.color} onChange={e => updateSelected({ color: e.currentTarget.value })} />
                                    </>
                                )}
                                {selected.type === "avatar" && (
                                    <select className="vc-meme-editor-select" value={selected.shape} onChange={e => updateSelected({ shape: e.currentTarget.value as "circle" | "square" })}>
                                        <option value="circle">Circle crop</option>
                                        <option value="square">Original square</option>
                                    </select>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button disabled={!ready} onClick={async () => {
                    if (!canvasRef.current) return;
                    renderCanvas();
                    const { blob, filename } = await exportUploadBlob(canvasRef.current);
                    renderCanvas();
                    modalProps.onClose();
                    window.setTimeout(() => {
                        pasteFileToCurrentChannel(new File([blob], filename, { type: blob.type }));
                    }, 100);
                }}>Paste to Chat</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function openEditor(imageUrl: string, guildId?: string) {
    openModal(modalProps => <MemeEditorModal imageUrl={imageUrl} guildId={guildId} modalProps={modalProps} />);
}

function getTargetImageUrl(target: EventTarget | null) {
    if (!(target instanceof Element)) return undefined;

    const image = target.closest("img") as HTMLImageElement | null;
    if (!image) return undefined;

    const src = image.currentSrc || image.src;
    if (!src) return undefined;

    try {
        const url = new URL(src);
        const isDiscordImage =
            url.hostname === "cdn.discordapp.com"
            || url.hostname === "media.discordapp.net"
            || url.hostname.endsWith(".discordapp.net")
            || url.hostname.endsWith(".discordapp.com");

        return isDiscordImage ? src : undefined;
    } catch {
        return undefined;
    }
}

function imageContextMenuPatch(children: React.ReactNode[], props: any) {
    const imageUrl = props?.src ?? props?.href ?? props?.url ?? props?.mediaUrl;
    if (!imageUrl) return;

    children.push(
        <Menu.MenuItem
            id="vc-meme-editor-open-image"
            label="Meme Editor"
            action={() => openEditor(imageUrl, SelectedChannelStore.getGuildId?.())}
        />
    );
}

function messageContextMenuPatch(children: React.ReactNode[], props: any) {
    const imageUrl = getImageUrl(props?.message);
    if (!imageUrl) return;

    children.push(
        <Menu.MenuItem
            id="vc-meme-editor-open-message"
            label="Meme Editor"
            action={() => openEditor(imageUrl, getGuildId(props?.message))}
        />
    );
}

export default definePlugin({
    name: "Meme Editor",
    description: "Open a canvas-based meme editor from image message context menus.",
    authors: [{ name: "ひなた", id: 1496985532499099649n }],

    start() {
        imageContextMenuListener = (event: MouseEvent) => {
            const imageUrl = getTargetImageUrl(event.target);
            if (!imageUrl) return;

            event.preventDefault();
            event.stopPropagation();

            ContextMenuApi.openContextMenu(event as any, props => (
                <Menu.Menu navId="vc-meme-editor-image-context" onClose={props.onClose}>
                    <Menu.MenuItem
                        id="vc-meme-editor-open-dom-image"
                        label="Meme Editor"
                        action={() => openEditor(imageUrl, SelectedChannelStore.getGuildId?.())}
                    />
                </Menu.Menu>
            ));
        };

        document.addEventListener("contextmenu", imageContextMenuListener, true);
    },

    stop() {
        if (imageContextMenuListener) {
            document.removeEventListener("contextmenu", imageContextMenuListener, true);
            imageContextMenuListener = undefined;
        }
    },

    contextMenus: {
        "message": messageContextMenuPatch,
        "image-context": imageContextMenuPatch
    }
});
