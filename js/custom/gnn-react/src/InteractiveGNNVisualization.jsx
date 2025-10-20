import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Zap,
  Share2,
  HelpCircle,
  CheckCircle,
  Building,
  Users,
  AlertTriangle,
  Network,
  RefreshCw,
  Activity,
} from "lucide-react";

// Removed top explanation card per request.

// --- Node and Edge definitions - Edges now primarily use 'weight' ---
const initialNodes = [
  {
    id: "A",
    x: 100,
    y: 200,
    type: "active",
    data: [5, 6, null, 8, 7],
    originalData: [5, 6, 0, 8, 7],
    predictedValue: null,
    label: "Sensor A",
  },
  {
    id: "B",
    x: 300,
    y: 100,
    type: "active",
    data: [10, 12, 11, null, 13],
    originalData: [10, 12, 11, 0, 13],
    predictedValue: null,
    label: "Sensor B",
  },
  {
    id: "C",
    x: 300,
    y: 300,
    type: "unmonitored",
    data: [null, null, null, null, null],
    originalData: [0, 0, 0, 0, 0],
    predictedValue: null,
    label: "Node C",
  },
  {
    id: "D",
    x: 500,
    y: 200,
    type: "active",
    data: [3, null, 4, 5, 4],
    originalData: [3, 0, 4, 5, 4],
    predictedValue: null,
    label: "Sensor D",
  },
  {
    id: "E",
    x: 400,
    y: 200,
    type: "unmonitored",
    data: [null, null, null, null, null],
    originalData: [0, 0, 0, 0, 0],
    predictedValue: null,
    label: "Node E",
  },
  {
    id: "F",
    x: 100,
    y: 350,
    type: "unmonitored",
    data: [null, null, null, null, null],
    originalData: [0, 0, 0, 0, 0],
    predictedValue: null,
    label: "Node F",
  },
];
const initialEdges = [
  { id: "e1", from: "A", to: "B", weight: 1 },
  { id: "e2", from: "A", to: "C", weight: 1 },
  { id: "e3", from: "A", to: "D", weight: 1 },
  { id: "e4", from: "A", to: "E", weight: 1 },
  { id: "e5", from: "A", to: "F", weight: 1 },
  { id: "e6", from: "B", to: "C", weight: 1 },
  { id: "e7", from: "B", to: "D", weight: 1 },
  { id: "e8", from: "B", to: "E", weight: 1 },
  { id: "e9", from: "B", to: "F", weight: 1 },
  { id: "e10", from: "C", to: "D", weight: 1 },
  { id: "e11", from: "C", to: "E", weight: 1 },
  { id: "e12", from: "C", to: "F", weight: 1 },
  { id: "e13", from: "D", to: "E", weight: 1 },
  { id: "e14", from: "D", to: "F", weight: 1 },
  { id: "e15", from: "E", to: "F", weight: 1 },
];

const Node = ({
  node,
  isSelected,
  onClick,
  animationPhase,
  animationTargetNodeId,
  isNeighborSource,
}) => {
  const isActiveSensor = node.type === "active";
  const isUnmonitored = node.type === "unmonitored";
  // Turn node green and show Pred for any target (sensor or unmonitored) once prediction is made
  const isPredicted =
    node.id === animationTargetNodeId &&
    (animationPhase === 3 || animationPhase === 4) &&
    node.predictedValue !== null;

  const getFillColor = () => {
    if (isPredicted) return "fill-green-500 hover:fill-green-600";
    if (isActiveSensor) return "fill-blue-500 hover:fill-blue-600";
    if (isUnmonitored) return "fill-gray-400 hover:fill-gray-500";
    return "fill-gray-300";
  };

  let gAnimationClass = "";
  if (animationPhase === 1) {
    if (isNeighborSource) gAnimationClass = "animate-pulse-strong";
    if (node.id === animationTargetNodeId)
      gAnimationClass = "animate-pulse-receive";
  } else if (animationPhase === 2 && node.id === animationTargetNodeId) {
    gAnimationClass = "animate-pulse-focus-target";
  }

  return (
    <g
      key={node.id}
      transform={`translate(${node.x}, ${node.y})`}
      onClick={() => onClick(node)}
      className={`cursor-pointer transition-all duration-300 ease-in-out ${gAnimationClass}`}
    >
      <circle
        r={isSelected ? 28 : 25}
        className={`${getFillColor()} transition-all duration-300 stroke-2 ${
          isSelected ||
          (animationPhase > 0 && node.id === animationTargetNodeId)
            ? "stroke-orange-500"
            : "stroke-gray-700"
        }`}
      />
      <text
        textAnchor="middle"
        dy=".3em"
        className="fill-white font-semibold select-none text-sm"
      >
        {node.id}
      </text>
      {isPredicted && (
        <text
          textAnchor="middle"
          y={40}
          className="fill-green-700 font-bold text-xs"
        >
          Pred: {node.predictedValue}
        </text>
      )}
      {isActiveSensor &&
        node.originalData.some((d) => d !== null && d !== 0) && (
          <text
            textAnchor="middle"
            y={-30}
            className="fill-blue-700 font-bold text-xs"
          >
            Data:{" "}
            {node.originalData
              .filter((d) => d !== null && d !== 0)
              .slice(0, 1)
              .join(",")}
          </text>
        )}
      <text
        textAnchor="middle"
        y={-45}
        className="fill-gray-700 text-xs font-medium"
      >
        {node.label}
      </text>
    </g>
  );
};

const Edge = ({
  edge,
  nodes,
  animationPhase,
  isFocusedAggregationEdge,
  computedWeight,
}) => {
  const nodeFrom = nodes.find((n) => n.id === edge.from);
  const nodeTo = nodes.find((n) => n.id === edge.to);
  if (!nodeFrom || !nodeTo) return null;

  let strokeColor = "stroke-slate-400";
  let opacityClass = "opacity-60";
  let strokeWidthClass = "stroke-2";

  const weight = Math.max(1, computedWeight ?? edge.weight ?? 1);

  if (weight === 1) {
    strokeWidthClass = "stroke-2";
    opacityClass = "opacity-50";
  } else if (weight === 2) {
    strokeWidthClass = "stroke-[3px]";
    opacityClass = "opacity-70";
  } else if (weight === 3) {
    strokeWidthClass = "stroke-[4px]";
    opacityClass = "opacity-85";
  } else if (weight >= 4) {
    strokeWidthClass = "stroke-[5px]";
    opacityClass = "opacity-95";
  }

  const strokeDasharray = edge.dashed ? "4,4" : "none";

  let animationClass = "";
  if (animationPhase === 1 && isFocusedAggregationEdge) {
    strokeColor = "stroke-orange-500";
    strokeWidthClass = "stroke-[3.5px]";
    opacityClass = "opacity-90";
    animationClass = "animate-pulse-edge-focus";
  }

  return (
    <line
      x1={nodeFrom.x}
      y1={nodeFrom.y}
      x2={nodeTo.x}
      y2={nodeTo.y}
      className={`${strokeColor} ${strokeWidthClass} ${opacityClass} ${animationClass} transition-colors duration-300`}
      markerEnd="url(#arrow)"
      strokeDasharray={strokeDasharray}
    />
  );
};

// Pass animation phase/target into chart to control flashing bars
const TimeSeriesChart = ({
  node,
  onAnimatePrediction,
  isAnimationRunning,
  animationPhase,
  animationTargetNodeId,
}) => {
  if (!node)
    return (
      <div className="p-4 text-sm text-gray-500 h-[500px] flex items-center justify-center">
        Select a node to see its data sequence.
      </div>
    );
  const barWidth = 30;
  const gap = 10;
  const chartHeight = 200;

  // Add padding around the drawable area to prevent flashing from being clipped
  const paddingX = 16; // left/right
  const paddingTop = 8; // top
  const paddingBottom = 40; // bottom (for labels)

  const contentWidth = (barWidth + gap) * node.data.length - gap;
  const svgWidth = contentWidth + paddingX * 2;
  const svgHeight = chartHeight + paddingTop + paddingBottom;

  const maxValue = Math.max(
    ...node.data.filter((d) => d !== null),
    ...node.originalData.filter((d) => d !== null),
    10
  );
  const canAnimate =
    node.data.includes(null) &&
    node.originalData.some((d, i) => d === 0 && node.data[i] === null);

  // Flash bars that contain data while aggregating for this target
  const isAggregatingThisTarget =
    animationPhase === 1 && node.id === animationTargetNodeId;

  return (
    <div className="p-4 bg-white rounded-lg shadow-md min-h-[500px]">
      <h4 className="font-semibold text-indigo-700 mb-2 text-center">
        Data Sequence for {node.label}
      </h4>
      <div className="flex justify-center overflow-x-auto pb-2">
        <svg width={svgWidth} height={svgHeight}>
          <g transform={`translate(${paddingX}, ${paddingTop})`}>
            {node.data.map((value, index) => {
              const originalValue = node.originalData[index];
              const x = index * (barWidth + gap);
              const barHeight =
                value === null
                  ? originalValue === 0
                    ? 5
                    : Math.max(5, (originalValue / maxValue) * chartHeight - 50)
                  : Math.max(5, (value / maxValue) * chartHeight - 50);
              const fillColor =
                value === null
                  ? originalValue === 0
                    ? "fill-red-300"
                    : "fill-gray-300"
                  : "fill-teal-500";
              const opacity = value === null && originalValue !== 0 ? 0.5 : 1;

              const hasDataBar = value !== null;
              const flashClass =
                isAggregatingThisTarget && hasDataBar
                  ? "animate-bar-flash-using-data"
                  : "";

              return (
                <g key={index}>
                  <rect
                    x={x}
                    y={chartHeight - barHeight}
                    width={barWidth}
                    height={barHeight}
                    className={`${fillColor} ${flashClass} transition-all duration-300`}
                    opacity={opacity}
                    rx="2"
                  />
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight + 15}
                    textAnchor="middle"
                    className="text-xs fill-gray-600"
                  >
                    T{index + 1}
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight - barHeight - 5}
                    textAnchor="middle"
                    className="text-xs font-semibold fill-gray-800"
                  >
                    {value !== null
                      ? value
                      : originalValue !== 0
                      ? `(${originalValue})`
                      : "N/A"}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {canAnimate && (
        <div className="text-center mt-3">
          <button
            onClick={() => onAnimatePrediction(node.id)}
            disabled={isAnimationRunning}
            className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm flex items-center justify-center mx-auto"
          >
            <Activity size={16} className="mr-2" /> Animate Prediction for{" "}
            {node.id}
          </button>
          <p className="text-xs text-red-500 mt-1">
            This node has missing data points (red bars).
          </p>
        </div>
      )}
      {!canAnimate && node.data.every((d) => d !== null) && (
        <p className="text-xs text-green-600 mt-2 text-center flex items-center justify-center">
          <CheckCircle size={14} className="mr-1" /> Data sequence complete.
        </p>
      )}
    </div>
  );
};

const InteractiveGNNVisualization = () => {
  const [nodes, setNodes] = useState(
    initialNodes.map((n) => ({
      ...n,
      data: n.originalData.map((d) => (d === 0 ? null : d)),
    }))
  );
  const [currentAnimationPhase, setCurrentAnimationPhase] = useState(0);
  const [selectedNode, setSelectedNode] = useState(null);
  // Removed top-level instructional text per request
  const [infoText, setInfoText] = useState("");
  const [aggregatingNodes, setAggregatingNodes] = useState({
    sources: [],
    targets: [],
  });
  const [aggregatingEdges, setAggregatingEdges] = useState([]);
  const [animationTargetNodeId, setAnimationTargetNodeId] = useState(null);
  const [isAnimationRunning, setIsAnimationRunning] = useState(false);

  // Keep internal phase text but do not render it in the UI
  const phaseExplanations = {
    0: "",
    1: (id) => `Phase 1 for ${id}`,
    2: (id) => `Phase 2 for ${id}`,
    3: (id) => `Phase 3 for ${id}`,
    4: (id) => `Done for ${id}`,
  };

  const handleNodeClick = useCallback(
    (node) => {
      if (isAnimationRunning) return;
      setSelectedNode(node);
    },
    [isAnimationRunning, currentAnimationPhase]
  );

  const startNodeFocusedAnimation = useCallback(
    (nodeId) => {
      if (isAnimationRunning) return;

      const targetNodeDetails = nodes.find((n) => n.id === nodeId);
      if (
        !targetNodeDetails ||
        !targetNodeDetails.data.includes(null) ||
        !targetNodeDetails.originalData.some(
          (d, i) => d === 0 && targetNodeDetails.data[i] === null
        )
      ) {
        setInfoText(
          `Node ${nodeId} has no missing data to interpolate or is already complete.`
        );
        return;
      }

      setIsAnimationRunning(true);
      setAnimationTargetNodeId(nodeId);

      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: n.originalData.map((d) => (d === 0 ? null : d)),
                predictedValue: null,
              }
            : n
        )
      );

      if (selectedNode && selectedNode.id === nodeId) {
        const freshTargetNodeData = initialNodes
          .find((n) => n.id === nodeId)
          .originalData.map((d) => (d === 0 ? null : d));
        setSelectedNode((prev) => ({
          ...prev,
          data: freshTargetNodeData,
          predictedValue: null,
        }));
      }

      setCurrentAnimationPhase(1);
      setInfoText(phaseExplanations[1](nodeId));

      // Focus only sensor neighbors
      const oneHopNeighbors = new Set();
      const focusedEdges = new Set();
      initialEdges.forEach((edge) => {
        let neighborId = null;
        if (edge.from === nodeId) neighborId = edge.to;
        else if (edge.to === nodeId) neighborId = edge.from;

        if (neighborId) {
          const neighbor = nodes.find((n) => n.id === neighborId);
          if (neighbor?.type === "active") {
            oneHopNeighbors.add(neighborId);
            focusedEdges.add(edge.id);
          }
        }
      });
      setAggregatingNodes({
        sources: Array.from(oneHopNeighbors),
        targets: [nodeId],
      });
      setAggregatingEdges(Array.from(focusedEdges));
    },
    [nodes, isAnimationRunning, selectedNode]
  );

  // Compute dynamic edge weights during animation
  const dynamicEdgeWeights = useMemo(() => {
    // Default: all edges minimum weight
    const map = new Map(initialEdges.map((e) => [e.id, 1]));

    // Only apply during active animation (phases 1-3)
    if (
      !animationTargetNodeId ||
      currentAnimationPhase === 0 ||
      currentAnimationPhase >= 4
    ) {
      return map;
    }

    const target = nodes.find((n) => n.id === animationTargetNodeId);
    if (!target) return map;

    const isTargetSensor = target.type === "active";

    // Eligible edges: only those touching the target and connecting to sensors
    const eligible = [];
    initialEdges.forEach((edge) => {
      let otherId = null;
      if (edge.from === target.id) otherId = edge.to;
      else if (edge.to === target.id) otherId = edge.from;

      if (!otherId) return;

      const other = nodes.find((n) => n.id === otherId);
      if (!other || other.type !== "active") return; // only connect to sensors

      // If target is a sensor, only sensor-sensor edges involving the target
      // If target is non-sensor, only target-to-sensor edges
      const dx = target.x - other.x;
      const dy = target.y - other.y;
      const dist = Math.hypot(dx, dy);
      eligible.push({ edgeId: edge.id, dist });
    });

    if (eligible.length === 0) return map;

    // Rank by distance (closer = stronger weight)
    const sorted = eligible.sort((a, b) => a.dist - b.dist);
    const n = sorted.length;
    const third = Math.max(1, Math.ceil(n / 3));
    sorted.forEach((item, idx) => {
      // 3 bins: closest -> 4, middle -> 3, far -> 2
      const w = idx < third ? 4 : idx < 2 * third ? 3 : 2;
      map.set(item.edgeId, w);
    });

    return map;
  }, [nodes, animationTargetNodeId, currentAnimationPhase]);

  useEffect(() => {
    let timer;
    if (currentAnimationPhase === 1 && animationTargetNodeId) {
      timer = setTimeout(() => {
        setCurrentAnimationPhase(2);
        setInfoText(phaseExplanations[2](animationTargetNodeId));
      }, 2000);
    } else if (currentAnimationPhase === 2 && animationTargetNodeId) {
      timer = setTimeout(() => {
        setNodes((prevNodes) => {
          const updatedNodes = prevNodes.map((n) => {
            if (n.id === animationTargetNodeId) {
              const newData = n.data.map((val, index) => {
                if (val === null && n.originalData[index] === 0) {
                  const prevVal = index > 0 ? n.data[index - 1] : null;
                  const nextVal =
                    index < n.data.length - 1 ? n.data[index + 1] : null;
                  if (
                    prevVal !== null &&
                    nextVal !== null &&
                    prevVal !== 0 &&
                    nextVal !== 0
                  )
                    return Math.round((prevVal + nextVal) / 2);
                  if (prevVal !== null && prevVal !== 0)
                    return Math.max(
                      1,
                      prevVal - Math.floor(Math.random() * 2 + 1)
                    );
                  if (nextVal !== null && nextVal !== 0)
                    return Math.max(
                      1,
                      nextVal - Math.floor(Math.random() * 2 + 1)
                    );
                  return Math.floor(Math.random() * 5) + 1;
                }
                return val;
              });
              return {
                ...n,
                data: newData,
                predictedValue: Math.floor(Math.random() * 10) + 5,
              };
            }
            return n;
          });
          const finalUpdatedNode = updatedNodes.find(
            (n) => n.id === animationTargetNodeId
          );
          if (
            selectedNode &&
            selectedNode.id === animationTargetNodeId &&
            finalUpdatedNode
          ) {
            setSelectedNode(finalUpdatedNode);
          }
          return updatedNodes;
        });
        setCurrentAnimationPhase(3);
        setInfoText(phaseExplanations[3](animationTargetNodeId));
        setAggregatingNodes({ sources: [], targets: [] });
        setAggregatingEdges([]);
      }, 2000);
    } else if (currentAnimationPhase === 3 && animationTargetNodeId) {
      timer = setTimeout(() => {
        setCurrentAnimationPhase(4);
        setInfoText(phaseExplanations[4](animationTargetNodeId));
        setIsAnimationRunning(false);
      }, 4000);
    }
    return () => clearTimeout(timer);
  }, [currentAnimationPhase, animationTargetNodeId, selectedNode]);

  const resetVisualization = useCallback(() => {
    setCurrentAnimationPhase(0);
    setNodes(
      initialNodes.map((n) => ({
        ...n,
        data: n.originalData.map((d) => (d === 0 ? null : d)),
        predictedValue: null,
      }))
    );
    setSelectedNode(null);
    setAggregatingNodes({ sources: [], targets: [] });
    setAggregatingEdges([]);
    setAnimationTargetNodeId(null);
    setIsAnimationRunning(false);
    setInfoText("");
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Force a re-render or recalculate dimensions
      window.dispatchEvent(new Event("resize"));
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="p-4 md:p-8 bg-slate-100 rounded-xl shadow-2xl">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: chart + legend */}
        <div className="lg:col-span-1 bg-white p-6 rounded-lg shadow-lg">
          <div className="mt-0">
            <TimeSeriesChart
              node={selectedNode}
              onAnimatePrediction={startNodeFocusedAnimation}
              isAnimationRunning={isAnimationRunning}
              animationPhase={currentAnimationPhase}
              animationTargetNodeId={animationTargetNodeId}
            />
          </div>
          <div className="mt-3 p-2 bg-gray-100 rounded-md text-xs text-left leading-tight space-y-1">
            <h5 className="font-semibold mb-0.5">Legend (Graph):</h5>
            <p>
              <span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-1 align-middle"></span>{" "}
              Active Sensor
            </p>
            <p>
              <span className="inline-block w-3 h-3 bg-gray-400 rounded-full mr-1 align-middle"></span>{" "}
              Unmonitored Node
            </p>
            <p>
              <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-1 align-middle"></span>{" "}
              Predicted/Interpolated Node
            </p>
            <h5 className="font-semibold mt-1 mb-0.5">Legend (Edges):</h5>
            <p>
              <span className="inline-block w-8 h-1 bg-slate-400 mr-1 align-middle"></span>{" "}
              Edge (Thicker = Higher Weight/Influence)
            </p>
            <p>
              <span className="inline-block w-8 h-0.5 bg-orange-500 mr-1 align-middle animate-pulse-edge-focus"></span>{" "}
              Animating Edge (Focused Aggregation)
            </p>
            <h5 className="font-semibold mt-1 mb-0.5">Legend (Chart):</h5>
            <p>
              <span className="inline-block w-3 h-3 bg-red-300 rounded-sm mr-1 align-middle"></span>{" "}
              Missing Data in Sequence
            </p>
            <p>
              <span className="inline-block w-3 h-3 bg-teal-500 rounded-sm mr-1 align-middle"></span>{" "}
              Available/Interpolated Data
            </p>
            <p>
              <span className="inline-block w-3 h-3 bg-gray-300 rounded-sm mr-1 align-middle"></span>{" "}
              Original Data (No Sensor Reading)
            </p>
          </div>
        </div>

        {/* Right column: graph */}
        <div className="lg:col-span-2 bg-white p-2 rounded-lg shadow-lg relative min-h-[400px] md:min-h-[500px]">
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 600 400"
            className="overflow-visible"
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="4"
                markerHeight="4"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
              </marker>
            </defs>
            {initialEdges.map((edge) => (
              <Edge
                key={edge.id}
                edge={edge}
                nodes={nodes}
                animationPhase={currentAnimationPhase}
                isFocusedAggregationEdge={aggregatingEdges.includes(edge.id)}
                computedWeight={dynamicEdgeWeights.get(edge.id)}
              />
            ))}
            {nodes.map((node) => (
              <Node
                key={node.id}
                node={node}
                isSelected={selectedNode?.id === node.id}
                onClick={handleNodeClick}
                animationPhase={currentAnimationPhase}
                animationTargetNodeId={animationTargetNodeId}
                isNeighborSource={aggregatingNodes.sources.includes(node.id)}
              />
            ))}
          </svg>
          {/* Moved keyframes to global CSS */}
        </div>
      </div>
    </div>
  );
};

export default InteractiveGNNVisualization;
