import { useEffect, useRef } from 'react';

type RelayNode = {
  x: number;
  y: number;
  radius: number;
  color: string;
};

const nodes: RelayNode[] = [
  { x: 0.48, y: 0.72, radius: 6, color: '#C59A32' },
  { x: 0.58, y: 0.48, radius: 7, color: '#2E7D57' },
  { x: 0.70, y: 0.60, radius: 8, color: '#00A7A5' },
  { x: 0.78, y: 0.34, radius: 7, color: '#C59A32' },
  { x: 0.90, y: 0.58, radius: 6, color: '#D95436' },
];

const routes = [
  [0, 1, 2],
  [1, 3, 4],
  [0, 2, 4],
];

function routePoints(width: number, height: number, route: number[]) {
  return route.map((nodeIndex) => {
    const node = nodes[nodeIndex];
    return {
      x: node.x * width,
      y: node.y * height,
    };
  });
}

function pointOnRoute(points: Array<{ x: number; y: number }>, progress: number) {
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    return { from: previous, to: point, length };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let distance = (progress % 1) * totalLength;

  for (const segment of segments) {
    if (distance <= segment.length) {
      const ratio = segment.length === 0 ? 0 : distance / segment.length;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
      };
    }
    distance -= segment.length;
  }

  return points[points.length - 1];
}

function drawRoute(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  route: number[],
  phase: number,
  routeIndex: number,
) {
  const points = routePoints(width, height, route);

  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
      return;
    }

    context.lineTo(point.x, point.y);
  });

  context.shadowColor = 'rgba(0, 167, 165, 0.42)';
  context.shadowBlur = 18;
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(0, 167, 165, 0.26)';
  context.stroke();
  context.setLineDash([10, 22]);
  context.lineDashOffset = -phase * 1.6;
  context.lineWidth = 3.2;
  context.strokeStyle = 'rgba(0, 222, 218, 0.86)';
  context.stroke();
  context.setLineDash([]);
  context.shadowBlur = 0;

  const packetCount = 3;
  for (let index = 0; index < packetCount; index += 1) {
    const packet = pointOnRoute(points, phase / 210 + routeIndex * 0.18 + index / packetCount);
    const radius = index === 0 ? 5.5 : 3.8;
    const gradient = context.createRadialGradient(packet.x, packet.y, 0, packet.x, packet.y, radius * 4.2);
    gradient.addColorStop(0, 'rgba(246, 247, 242, 0.98)');
    gradient.addColorStop(0.32, 'rgba(0, 222, 218, 0.92)');
    gradient.addColorStop(1, 'rgba(0, 222, 218, 0)');

    context.beginPath();
    context.arc(packet.x, packet.y, radius * 4.2, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    context.arc(packet.x, packet.y, radius, 0, Math.PI * 2);
    context.fillStyle = index === 0 ? '#f6f7f2' : '#00ded8';
    context.fill();
  }
}

export function ProtocolRelayCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const drawingCanvas = canvas;
    const drawingContext = context;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let visible = true;

    function resize() {
      const rect = drawingCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      drawingCanvas.width = width * dpr;
      drawingCanvas.height = height * dpr;
      drawingContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function render(time = 0) {
      drawingContext.clearRect(0, 0, width, height);
      drawingContext.globalCompositeOperation = 'source-over';

      for (const [routeIndex, route] of routes.entries()) {
        drawRoute(drawingContext, width, height, route, reduceMotion.matches ? routeIndex * 36 : time / 18, routeIndex);
      }

      for (const node of nodes) {
        const x = node.x * width;
        const y = node.y * height;
        const pulse = reduceMotion.matches ? 0.4 : 0.7 + Math.sin(time / 360 + x) * 0.34;

        drawingContext.beginPath();
        drawingContext.arc(x, y, node.radius * (5.6 + pulse * 2.2), 0, Math.PI * 2);
        drawingContext.strokeStyle = `${node.color}28`;
        drawingContext.lineWidth = 2;
        drawingContext.stroke();

        drawingContext.beginPath();
        drawingContext.arc(x, y, node.radius * 4.8, 0, Math.PI * 2);
        drawingContext.fillStyle = `${node.color}28`;
        drawingContext.fill();

        drawingContext.beginPath();
        drawingContext.arc(x, y, node.radius + pulse * 4, 0, Math.PI * 2);
        drawingContext.fillStyle = node.color;
        drawingContext.fill();

        drawingContext.beginPath();
        drawingContext.arc(x, y, node.radius + 7, 0, Math.PI * 2);
        drawingContext.strokeStyle = `${node.color}66`;
        drawingContext.lineWidth = 1;
        drawingContext.stroke();
      }

      if (!reduceMotion.matches && visible) {
        animationFrame = window.requestAnimationFrame(render);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const wasVisible = visible;
          visible = entry.isIntersecting;
          if (!wasVisible && visible && !reduceMotion.matches) {
            animationFrame = window.requestAnimationFrame(render);
          }
        }
      },
      { threshold: 0 },
    );

    resize();
    render();
    observer.observe(drawingCanvas);
    window.addEventListener('resize', resize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-relay-canvas absolute inset-0 h-full w-full opacity-80" aria-hidden="true" />;
}
