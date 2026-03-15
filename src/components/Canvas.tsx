import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Line } from 'react-konva';
import { DrawingLine } from '../types';

interface CanvasProps {
  lines: DrawingLine[];
  onDraw?: (lines: DrawingLine[]) => void;
  isReadOnly?: boolean;
  color?: string;
  strokeWidth?: number;
}

export const Canvas: React.FC<CanvasProps> = ({
  lines,
  onDraw,
  isReadOnly = false,
  color = '#000000',
  strokeWidth = 5
}) => {
  const isDrawing = useRef(false);
  const stageRef = useRef<any>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleMouseDown = (e: any) => {
    if (isReadOnly) return;
    isDrawing.current = true;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    
    // Normalize coordinates
    const normalizedX = (pos.x / containerSize.width) * 1000;
    const normalizedY = (pos.y / containerSize.height) * 1000;
    
    onDraw?.([...lines, { tool: 'pen', points: [normalizedX, normalizedY], color, strokeWidth }]);
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing.current || isReadOnly) return;

    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    
    // Normalize coordinates
    const normalizedX = (point.x / containerSize.width) * 1000;
    const normalizedY = (point.y / containerSize.height) * 1000;
    
    const lastLine = lines[lines.length - 1];
    
    if (!lastLine) return;

    // Add point to the last line
    const newLastLine = {
      ...lastLine,
      points: lastLine.points.concat([normalizedX, normalizedY])
    };

    const newLines = [...lines.slice(0, -1), newLastLine];
    onDraw?.(newLines);
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
  };

  return (
    <div ref={containerRef} className="w-full h-full bg-white rounded-lg shadow-inner overflow-hidden cursor-crosshair">
      <Stage
        width={containerSize.width}
        height={containerSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        ref={stageRef}
      >
        <Layer>
          {lines.map((line, i) => (
            <Line
              key={i}
              points={line.points.map((p, idx) => {
                // De-normalize coordinates for rendering
                const scale = idx % 2 === 0 ? containerSize.width / 1000 : containerSize.height / 1000;
                return p * scale;
              })}
              stroke={line.color}
              strokeWidth={line.strokeWidth}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation={
                line.tool === 'eraser' ? 'destination-out' : 'source-over'
              }
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};
