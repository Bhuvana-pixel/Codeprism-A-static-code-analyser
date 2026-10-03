import { ArchitecturalLayer, ArchitectureSummary, ArchitectureViolation, IREntity, IRRelationship } from './types';

export class ArchitectureDetector {
  /**
   * Evaluates multiple signals (filename, path, annotations, relationships) to detect layer and confidence
   */
  static detectLayerWithConfidence(
    entity: IREntity,
    relationships: IRRelationship[] = []
  ): { layer: ArchitecturalLayer; confidence: number } {
    // If developer manually specified a role override, respect user choice with 100% confidence!
    if (entity.archRoleOverride) {
      return { layer: entity.archRoleOverride, confidence: 100 };
    }

    const nameLower = entity.name.toLowerCase();
    const pathLower = entity.relativePath.toLowerCase().replace(/\\/g, '/');

    let layer: ArchitecturalLayer = 'unknown';
    let score = 40;

    // 1. Controller / Route / API Presentation Layer
    if (
      nameLower.includes('controller') ||
      nameLower.includes('handler') ||
      nameLower.includes('route') ||
      nameLower.includes('endpoint') ||
      pathLower.includes('/controllers/') ||
      pathLower.includes('/routes/') ||
      pathLower.includes('/endpoints/') ||
      pathLower.includes('/handlers/')
    ) {
      layer = 'controller';
      if (nameLower.includes('controller') || nameLower.includes('route')) score += 35;
      if (pathLower.includes('/controllers/') || pathLower.includes('/routes/')) score += 25;
    }
    // 2. Service / Business Logic Layer
    else if (
      nameLower.includes('service') ||
      nameLower.includes('usecase') ||
      nameLower.includes('manager') ||
      nameLower.includes('logic') ||
      pathLower.includes('/services/') ||
      pathLower.includes('/usecases/') ||
      pathLower.includes('/domain/')
    ) {
      layer = 'service';
      if (nameLower.includes('service') || nameLower.includes('usecase')) score += 35;
      if (pathLower.includes('/services/') || pathLower.includes('/domain/')) score += 25;
    }
    // 3. Repository / Data Access Layer
    else if (
      nameLower.includes('repository') ||
      nameLower.includes('repo') ||
      nameLower.includes('dao') ||
      nameLower.includes('store') ||
      pathLower.includes('/repositories/') ||
      pathLower.includes('/repos/') ||
      pathLower.includes('/dao/')
    ) {
      layer = 'repository';
      if (nameLower.includes('repository') || nameLower.includes('dao')) score += 35;
      if (pathLower.includes('/repositories/') || pathLower.includes('/dao/')) score += 25;
    }
    // 4. Model / Entity Layer
    else if (
      nameLower.includes('model') ||
      nameLower.includes('entity') ||
      nameLower.includes('schema') ||
      nameLower.includes('dto') ||
      nameLower.includes('struct') ||
      pathLower.includes('/models/') ||
      pathLower.includes('/entities/') ||
      pathLower.includes('/schemas/') ||
      pathLower.includes('/dto/')
    ) {
      layer = 'model';
      if (nameLower.includes('model') || nameLower.includes('entity')) score += 35;
      if (pathLower.includes('/models/') || pathLower.includes('/entities/')) score += 25;
    }
    // 5. Utility / Helper Layer
    else if (
      nameLower.includes('util') ||
      nameLower.includes('helper') ||
      nameLower.includes('common') ||
      nameLower.includes('tool') ||
      pathLower.includes('/utils/') ||
      pathLower.includes('/helpers/') ||
      pathLower.includes('/common/')
    ) {
      layer = 'utility';
      score += 30;
    }
    // 6. Config Layer
    else if (
      nameLower.includes('config') ||
      nameLower.includes('setting') ||
      nameLower.includes('option') ||
      pathLower.includes('/config/') ||
      pathLower.includes('/settings/')
    ) {
      layer = 'config';
      score += 35;
    }
    // 7. View / UI Component Layer
    else if (
      nameLower.includes('component') ||
      nameLower.includes('view') ||
      nameLower.includes('page') ||
      pathLower.includes('/components/') ||
      pathLower.includes('/views/') ||
      pathLower.includes('/pages/')
    ) {
      layer = 'view';
      score += 30;
    }

    const finalConfidence = layer === 'unknown' ? 50 : Math.min(98, Math.max(55, score));
    return { layer, confidence: finalConfidence };
  }

  static detectLayer(entity: IREntity): ArchitecturalLayer {
    return this.detectLayerWithConfidence(entity).layer;
  }

  /**
   * Analyzes project architecture summary, likely patterns, and potential violations
   */
  static analyzeWorkspaceArchitecture(
    entities: Record<string, IREntity>,
    relationships: IRRelationship[]
  ): ArchitectureSummary {
    const layerCounts: Record<ArchitecturalLayer, number> = {
      controller: 0,
      service: 0,
      repository: 0,
      model: 0,
      utility: 0,
      config: 0,
      api: 0,
      db: 0,
      view: 0,
      unknown: 0
    };

    Object.values(entities).forEach(e => {
      const { layer, confidence } = this.detectLayerWithConfidence(e, relationships);
      e.archLayer = layer;
      e.archConfidence = confidence;
      layerCounts[layer]++;
    });

    // Detect likely architecture pattern
    let likelyPattern = 'Layered Modular Architecture';
    let patternConfidence = 85;
    let evidence = 'System components are grouped by domain responsibilities.';

    if (layerCounts.controller > 0 && layerCounts.service > 0 && layerCounts.repository > 0 && layerCounts.model > 0) {
      likelyPattern = 'Layered Architecture (MVC / Repository Pattern)';
      patternConfidence = 94;
      evidence = 'Controllers depend on Services, which coordinate with Repositories and Models.';
    } else if (layerCounts.view > 0 && layerCounts.controller > 0) {
      likelyPattern = 'Component-Based Web Architecture';
      patternConfidence = 88;
      evidence = 'UI Components communicate with Controllers and API Routes.';
    } else if (layerCounts.service > 0 && layerCounts.model > 0) {
      likelyPattern = 'Domain Service Architecture';
      patternConfidence = 82;
      evidence = 'Domain services operate directly on data models.';
    }

    // Detect potential architecture violations & assign Traffic Light status
    const violations = this.detectArchitectureViolations(entities, relationships);

    const totalLayers = Object.values(layerCounts).filter(c => c > 0).length;

    return {
      likelyPattern,
      patternConfidence,
      evidence,
      totalLayers,
      violations
    };
  }

  /**
   * Evaluates relationship Traffic Light status (🟢 Healthy, 🟡 Concern, 🔴 Violation) and flags entity health
   */
  static detectArchitectureViolations(
    entities: Record<string, IREntity>,
    relationships: IRRelationship[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    let violationIdx = 1;

    // Reset default healthy status
    Object.values(entities).forEach(e => {
      e.healthStatus = 'healthy';
      e.statusReason = 'Standard architectural component with healthy dependency flow.';
    });

    relationships.forEach(rel => {
      if (rel.kind === 'CONTAINS') {
        rel.trafficStatus = 'healthy';
        return;
      }

      const source = entities[rel.sourceId];
      const target = entities[rel.targetId];

      if (!source || !target || source.id === target.id) {
        rel.trafficStatus = 'healthy';
        return;
      }

      const srcLayer = source.archLayer;
      const tgtLayer = target.archLayer;

      let isViolation = false;
      let isWarning = false;
      let reason = '';

      // 1. Controller / View bypassing Service layer directly to Repository or Database
      if ((srcLayer === 'controller' || srcLayer === 'view' || srcLayer === 'api') && (tgtLayer === 'repository' || tgtLayer === 'db')) {
        isViolation = true;
        reason = `${source.name} (${srcLayer}) directly depends on ${target.name} (${tgtLayer}), bypassing business logic (Service layer).`;
        violations.push({
          id: `viol-${violationIdx++}`,
          sourceEntityId: source.id,
          sourceName: source.name,
          sourceLayer: srcLayer,
          targetEntityId: target.id,
          targetName: target.name,
          targetLayer: tgtLayer,
          violationType: 'bypassed_service',
          description: reason,
          expectedDirection: 'Controller ➔ Service ➔ Repository'
        });
      }

      // 2. Reverse call: Service or Repository calling Controller / View
      else if ((srcLayer === 'service' || srcLayer === 'repository' || srcLayer === 'model' || srcLayer === 'db') && (tgtLayer === 'controller' || tgtLayer === 'view')) {
        isViolation = true;
        reason = `${source.name} (${srcLayer}) calls presentation layer ${target.name} (${tgtLayer}). Reverse layer coupling detected.`;
        violations.push({
          id: `viol-${violationIdx++}`,
          sourceEntityId: source.id,
          sourceName: source.name,
          sourceLayer: srcLayer,
          targetEntityId: target.id,
          targetName: target.name,
          targetLayer: tgtLayer,
          violationType: 'reverse_layer_call',
          description: reason,
          expectedDirection: 'Presentation ➔ Service / Data Access'
        });
      }

      // 3. Potential Concern: Config/Utility calling core Business Logic
      else if ((srcLayer === 'config' || srcLayer === 'utility') && (tgtLayer === 'service' || tgtLayer === 'repository' || tgtLayer === 'model')) {
        isWarning = true;
        reason = `${source.name} (${srcLayer}) references domain logic in ${target.name} (${tgtLayer}). Suspicious coupling.`;
      }

      // 4. Low confidence layer mapping
      else if ((source.archConfidence && source.archConfidence < 50) || (target.archConfidence && target.archConfidence < 50)) {
        isWarning = true;
        reason = `Uncertain architectural role classification between ${source.name} and ${target.name}.`;
      }

      // Assign Relationship Traffic Light Status
      if (isViolation) {
        rel.trafficStatus = 'violation';
        source.healthStatus = 'violation';
        target.healthStatus = 'violation';
        source.statusReason = reason;
        target.statusReason = reason;
      } else if (isWarning) {
        rel.trafficStatus = 'warning';
        if (source.healthStatus !== 'violation') {
          source.healthStatus = 'warning';
          source.statusReason = reason;
        }
        if (target.healthStatus !== 'violation') {
          target.healthStatus = 'warning';
          target.statusReason = reason;
        }
      } else {
        rel.trafficStatus = 'healthy';
      }
    });

    return violations;
  }
}
