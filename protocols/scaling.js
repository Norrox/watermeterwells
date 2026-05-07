function applyScaling(rawValue, cfg) {
  const scalingMode = cfg.scalingMode || 'linear';
  let value = rawValue;

  switch (scalingMode) {
    case 'direct':
      break;

    case 'linear':
      {
        const factor = parseFloat(cfg.scalingFactor) || 1;
        const offset = parseFloat(cfg.offset) || 0;
        value = rawValue * factor + offset;
      }
      break;

    case '4-20mA':
      {
        const signalMin = parseFloat(cfg.signalMin) || 4;
        const signalMax = parseFloat(cfg.signalMax) || 20;
        const scaleMin = parseFloat(cfg.scaleMin) || 0;
        const scaleMax = parseFloat(cfg.scaleMax) || 100;
        const ratio = (rawValue - signalMin) / (signalMax - signalMin);
        value = Math.max(0, ratio) * (scaleMax - scaleMin) + scaleMin;
      }
      break;

    case '0-10V':
      {
        const vMin = parseFloat(cfg.signalMin) || 0;
        const vMax = parseFloat(cfg.signalMax) || 10;
        const scaleMin = parseFloat(cfg.scaleMin) || 0;
        const scaleMax = parseFloat(cfg.scaleMax) || 100;
        const ratio = (rawValue - vMin) / (vMax - vMin);
        value = Math.max(0, ratio) * (scaleMax - scaleMin) + scaleMin;
      }
      break;

    case 'builder':
      {
        const divide = parseFloat(cfg.divide) || 1;
        const subtract = parseFloat(cfg.subtract) || 0;
        const multiply = parseFloat(cfg.multiply) || 1;
        const add = parseFloat(cfg.add) || 0;
        value = (rawValue / divide - subtract) * multiply + add;
        if (cfg.clampMinEnabled) value = Math.max(parseFloat(cfg.clampMin) || 0, value);
        if (cfg.clampMaxEnabled) value = Math.min(parseFloat(cfg.clampMax) || 0, value);
      }
      break;

    case 'custom':
      if (cfg.customExpression) {
        try {
          const expr = cfg.customExpression;
          const fn = new Function('value', 'Math', 'return ' + expr);
          value = fn(rawValue, Math);
        } catch (e) {}
      }
      break;
  }

  if (cfg.unitMultiplier) {
    value *= parseFloat(cfg.unitMultiplier);
  }

  const decimals = cfg.decimals !== undefined && cfg.decimals !== null ? parseInt(cfg.decimals) : null;
  if (decimals !== null && !isNaN(decimals)) {
    value = parseFloat(value.toFixed(decimals));
    if (isNaN(value)) value = 0;
  }

  return value;
}

module.exports = { applyScaling };
