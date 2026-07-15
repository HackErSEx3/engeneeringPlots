/**
 * Equivalent of PlotDataLabelCoordinateHelper.CalculateLabelCoordinates
 * xAnchorValue: 0 => label grows right, otherwise grows left
 */
function calculateLabelCoordinates(x, y, xAnchorValue, labelSize) {
  let x1, x2;

  if (xAnchorValue === 0) {
    x1 = x;
    x2 = x1 + labelSize.width;
  } else {
    x2 = x;
    x1 = x2 - labelSize.width;
  }

  const y1 = y - labelSize.height / 2.0;
  const y2 = y + labelSize.height / 2.0;

  return { x1, x2, y1, y2 };
}

/**
 * Equivalent of PlotDataLabelCoordinateHelper.DataLabelOverlap
 */
function dataLabelOverlap(newRect, existingRect) {
  const xOverlap1 =
    (newRect.x1 >= existingRect.x1 && newRect.x1 <= existingRect.x2) ||
    (newRect.x2 >= existingRect.x1 && newRect.x2 <= existingRect.x2);

  if (xOverlap1) {
    const yOverlap1 =
      (newRect.y1 >= existingRect.y1 && newRect.y1 <= existingRect.y2) ||
      (newRect.y2 >= existingRect.y1 && newRect.y2 <= existingRect.y2);

    if (yOverlap1) return true;
  }

  const xOverlap2 =
    (existingRect.x1 >= newRect.x1 && existingRect.x1 <= newRect.x2) ||
    (existingRect.x2 >= newRect.x1 && existingRect.x2 <= newRect.x2);

  if (xOverlap2) {
    const yOverlap2 =
      (existingRect.y1 >= newRect.y1 && existingRect.y1 <= newRect.y2) ||
      (existingRect.y2 >= newRect.y1 && existingRect.y2 <= newRect.y2);

    if (yOverlap2) return true;
  }

  return false;
}

function hasOverlapWithAny(newRect, existingRects) {
  for (const rect of existingRects) {
    if (dataLabelOverlap(newRect, rect)) {
      return true;
    }
  }
  return false;
}

/**
 * Polar label placement flow (same pattern as PlotDataLabelHelper)
 * points: [{x, y, labelText, xAnchorValue}]
 * measureString: (text) => {width, height}
 * drawLabel: (text, x, y, xAnchorValue) => void
 */
function drawPolarLabelsWithoutOverlap(points, measureString, drawLabel) {
  const placedLabelRects = [];

  for (const p of points) {
    if (!p.labelText) continue;

    const labelSize = measureString(p.labelText);
    const rect = calculateLabelCoordinates(p.x, p.y, p.xAnchorValue, labelSize);

    if (!hasOverlapWithAny(rect, placedLabelRects)) {
      placedLabelRects.push(rect);
      drawLabel(p.labelText, p.x, p.y, p.xAnchorValue);
    }
  }

  return placedLabelRects;
}
