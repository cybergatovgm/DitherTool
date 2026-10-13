import gifenc from 'gifenc';
import gifuct from 'gifuct-js';

const { GIFEncoder, applyPalette } = gifenc;
const { decompressFrames, parseGIF } = gifuct;

export const MAX_GIF_DURATION_MS = 15_000;
export const MAX_GIF_FPS = 10;
export const MAX_GIF_WIDTH = 480;

export function upsertKeyframe(keyframes, time, value) {
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(value)) {
        throw new RangeError('Keyframe time must be finite and non-negative, and value must be finite.');
    }
    const frameTime = Math.round(time);
    const existing = keyframes.findIndex(frame => frame.time === frameTime);
    const frame = { time: frameTime, value };
    if (existing >= 0) keyframes[existing] = frame;
    else keyframes.push(frame);
    keyframes.sort((a, b) => a.time - b.time);
    return keyframes;
}

export function getKeyframedValue(keyframes, time, baseValue) {
    if (!keyframes.length || time < keyframes[0].time) return baseValue;
    const nextIndex = keyframes.findIndex(frame => frame.time >= time);
    if (nextIndex < 0) return keyframes[keyframes.length - 1].value;
    const next = keyframes[nextIndex];
    if (next.time === time || nextIndex === 0) return next.value;
    const previous = keyframes[nextIndex - 1];
    const progress = (time - previous.time) / (next.time - previous.time);
    return previous.value + (next.value - previous.value) * progress;
}

export function getTimelineTime(timeMs, durationMs, loop = false) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        throw new RangeError('Timeline time must be finite and duration must be positive.');
    }
    const time = Math.max(0, timeMs);
    return loop ? time % durationMs : Math.min(time, durationMs);
}

export function seekVideoFrame(video, timeSeconds, signal) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
        return Promise.reject(new RangeError('Video seek time must be finite and non-negative.'));
    }
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!video.seeking && Math.abs(video.currentTime - timeSeconds) < 0.0005) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        const onSeeked = () => {
            if (video.seeking) return;
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error('Video seeking failed.'));
        };
        const onAbort = () => {
            cleanup();
            reject(signal.reason);
        };
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Video seeking timed out.'));
        }, 10_000);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            video.currentTime = timeSeconds;
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}

export function getExportDuration(durationMs, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > MAX_GIF_DURATION_MS / 1000) {
        throw new RangeError('GIF duration must be between 0.1 and 15 seconds.');
    }
    if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs <= 0)) {
        throw new RangeError('Source duration must be positive and finite.');
    }
    const requestedMs = Math.round(seconds * 1000);
    return durationMs === null ? requestedMs : Math.min(durationMs, requestedMs);
}

export function getExportFrameCount(durationMs, fps = MAX_GIF_FPS) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
    return Math.max(1, Math.ceil(Math.min(durationMs, MAX_GIF_DURATION_MS) * fps / 1000));
}

export function getFrameDimensions(width, height, maxWidth = MAX_GIF_WIDTH) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new RangeError('Frame dimensions must be positive integers.');
    }
    const scale = Math.min(1, maxWidth / width);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

export function getForegroundCells(indexed, width, colors, paperColor) {
    const cells = [];
    for (let index = 0; index < indexed.length; index++) {
        const color = colors[indexed[index]];
        if (color.hex !== paperColor) {
            cells.push([index % width, Math.floor(index / width), color.hex]);
        }
    }
    return cells;
}

export function decodeGif(buffer) {
    const parsed = parseGIF(buffer);
    const { width, height } = parsed.lsd;
    if (!width || !height || width > 4096 || height > 4096) {
        throw new RangeError('GIF dimensions are not supported.');
    }
    const frames = decompressFrames(parsed, true);
    if (!frames.length) throw new Error('GIF contains no image frames.');

    const normalizedFrames = frames.map(frame => ({
        ...frame,
        delay: Math.max(20, frame.delay || 100)
    }));
    const duration = normalizedFrames.reduce((sum, frame) => sum + frame.delay, 0);
    const backgroundColor = parsed.gct?.[parsed.lsd.backgroundColorIndex];
    const transparentBackground = normalizedFrames[0].transparentIndex === parsed.lsd.backgroundColorIndex;
    return {
        width,
        height,
        frames: normalizedFrames,
        duration,
        backgroundColor: transparentBackground || !backgroundColor ? null : backgroundColor
    };
}

export function createGifComposer(gif) {
    const canvas = document.createElement('canvas');
    canvas.width = gif.width;
    canvas.height = gif.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a GIF canvas.');
    const patchCanvas = document.createElement('canvas');
    const patchContext = patchCanvas.getContext('2d');
    if (!patchContext) throw new Error('Could not create a GIF patch canvas.');
    const background = gif.backgroundColor
        ? `rgb(${gif.backgroundColor[0]}, ${gif.backgroundColor[1]}, ${gif.backgroundColor[2]})`
        : null;

    let currentFrame = -1;
    let restoreFrame = null;
    let frameStarts = [0];
    for (const frame of gif.frames) {
        frameStarts.push(frameStarts[frameStarts.length - 1] + frame.delay);
    }

    function reset() {
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (background) {
            context.fillStyle = background;
            context.fillRect(0, 0, canvas.width, canvas.height);
        }
        currentFrame = -1;
        restoreFrame = null;
    }
    reset();

    function drawFrameAt(timeMs, targetCanvas) {
        const time = ((Math.max(0, timeMs) % gif.duration) + gif.duration) % gif.duration;
        let targetFrame = frameStarts.findIndex((start, index) =>
            index < gif.frames.length && time < frameStarts[index + 1]
        );
        if (targetFrame < 0) targetFrame = gif.frames.length - 1;
        if (targetFrame < currentFrame) reset();

        while (currentFrame < targetFrame) {
            if (currentFrame >= 0) {
                const previous = gif.frames[currentFrame];
                if (previous.disposalType === 2) {
                    context.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
                    if (background) {
                        context.fillStyle = background;
                        context.fillRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
                    }
                } else if (previous.disposalType === 3 && restoreFrame) {
                    context.putImageData(restoreFrame, 0, 0);
                }
            }

            currentFrame++;
            const frame = gif.frames[currentFrame];
            restoreFrame = frame.disposalType === 3
                ? context.getImageData(0, 0, canvas.width, canvas.height)
                : null;
            patchCanvas.width = frame.dims.width;
            patchCanvas.height = frame.dims.height;
            patchContext.putImageData(new ImageData(frame.patch, frame.dims.width, frame.dims.height), 0, 0);
            context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
        }

        const targetContext = targetCanvas.getContext('2d');
        if (!targetContext) throw new Error('Could not create a GIF preview canvas.');
        targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        targetContext.drawImage(canvas, 0, 0, targetCanvas.width, targetCanvas.height);
        return targetFrame;
    }

    return { drawFrameAt, reset };
}

export function createGifEncoder(width, height, palette, transparentIndex = -1) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_GIF_WIDTH || height > 65_535) {
        throw new RangeError('GIF dimensions are not supported.');
    }
    if (!Array.isArray(palette) || palette.length < 2 || palette.length > 256) {
        throw new RangeError('GIF palette must contain between 2 and 256 colors.');
    }

    const encoder = GIFEncoder();
    let frameCount = 0;
    return {
        writeFrame(rgba, delay = 100) {
            if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) {
                throw new RangeError('GIF frame pixel data does not match its dimensions.');
            }
            const index = applyPalette(rgba, palette, 'rgba4444');
            const options = {
                delay: Math.max(100, Math.round(delay / 100) * 100),
                transparent: transparentIndex >= 0,
                transparentIndex: Math.max(0, transparentIndex),
                repeat: 0
            };
            if (frameCount === 0) options.palette = palette;
            encoder.writeFrame(index, width, height, options);
            frameCount++;
        },
        finish() {
            if (frameCount === 0) throw new Error('Cannot export an empty GIF.');
            encoder.finish();
            return encoder.bytes();
        }
    };
}
