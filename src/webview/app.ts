import * as d3 from 'd3';
import { GraphData, IREntity, IRRelationship } from '../analyzer/types';

declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
};

const vscode = acquireVsCodeApi();

interface NodeItem extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  kind: string;
  language: string;
  filePath: string;
  line: number;
  archLayer: string;
  archConfidence?: number;
  metrics: any;
  isUnused?: boolean;
  column: number;
  row: number;
}

interface LinkItem extends d3.SimulationLinkDatum<NodeItem> {
  id: string;
  source: string | NodeItem;
  target: string | NodeItem;
  kind: string;
  certainty: string;
}

interface BreadcrumbItem {
  id: string;
  label: string;
  level: number;
}

class CodePrismApp {
  private rawGraphData: GraphData | null = null;
  private currentTab: 'intelligence' | 'timeMachine' | 'graph' = 'intelligence';
  private currentMode: 'architecture' | 'dependencies' | 'callgraph' | 'full' = 'architecture';
  private currentLevel: number = 2; // Default Level 2 (Files)
  private selectedNode: NodeItem | null = null;
  private searchTerm: string = '';

  private nodeExplanationCache: Map<string, any> = new Map();
  private moduleExplanationCache: Map<string, any> = new Map();

  private tmCommits: any[] = [];
  private activeComparison: any = null;

  private currentImpactDepth: string = '2';
  private isFocusImpactMode: boolean = false;
  private isComponentFocusActive: boolean = false;
  private currentImpactResult: any = null;

  private clickTimer: any = null;

  private breadcrumbs: BreadcrumbItem[] = [
    { id: 'root', label: 'Project', level: 1 }
  ];

  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
  private containerGroup: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
  private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;

  constructor() {
    this.svg = d3.select<SVGSVGElement, unknown>('#graphSvg');
    this.containerGroup = this.svg.append('g').attr('class', 'graph-container');

    this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 5])
      .on('zoom', (event) => {
        this.containerGroup.attr('transform', event.transform);
      });

    this.svg.call(this.zoomBehavior);

    this.initEventListeners();

    // Trigger analysis immediately on webview load
    vscode.postMessage({ command: 'requestAnalysis' });
  }

  private initEventListeners() {
    window.addEventListener('resize', () => {
      if (this.currentTab === 'graph') {
        this.autoFitToContent();
      }
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.command) {
        case 'updateGraph':
          this.rawGraphData = msg.data;
          this.updateDashboard(msg.data);
          this.updateStats(msg.data.stats);
          this.checkCycleWarnings(msg.data.stats.circularDependencies);
          this.render();
          break;
        case 'highlightFile':
          this.switchTab('graph');
          this.highlightFile(msg.filePath);
          break;
        case 'gitHistoryResult':
          this.renderGitEvolution(msg.evolution);
          break;
        case 'impactAnalysisResult':
          this.currentImpactResult = msg.impact;
          this.renderImpactResults(msg.impact);
          this.applyImpactGraphHighlight(msg.impact);
          break;
        case 'nodeExplanationResult':
          this.renderNodeExplanation(msg.entityId, msg.explanation);
          break;
        case 'moduleExplanationResult':
          this.renderModuleExplanation(msg.moduleName, msg.explanation);
          break;
        case 'timeMachineCommitsResult':
          this.tmCommits = msg.commits || [];
          this.renderTimeMachineCommits(this.tmCommits);
          break;
        case 'commitSnapshotResult':
          if (msg.snapshot && msg.snapshot.graphData) {
            this.rawGraphData = msg.snapshot.graphData;
            this.render();
            this.switchTab('graph');
          }
          break;
        case 'comparisonResult':
          this.activeComparison = msg.comparison;
          this.renderComparisonResults(msg.comparison);
          break;
        case 'explainChangeResult':
          this.renderExplainChangeResult(msg.explanation);
          break;
      }
    });

    document.getElementById('btnExplainNode')?.addEventListener('click', () => {
      if (!this.selectedNode) return;
      const panel = document.getElementById('llmExplanationPanel');
      const spinner = document.getElementById('llmLoadingSpinner');
      const results = document.getElementById('llmExplanationResults');

      if (panel) panel.classList.remove('hidden');
      if (spinner) spinner.classList.remove('hidden');
      if (results) results.innerHTML = '';

      vscode.postMessage({
        command: 'requestNodeExplanation',
        entityId: this.selectedNode.id
      });
    });

    document.getElementById('btnExplainModuleDashboard')?.addEventListener('click', () => {
      const dropdown = document.getElementById('moduleSelectDropdown') as HTMLSelectElement;
      const chosen = dropdown ? dropdown.value : 'controller';

      if (chosen) {
        const card = document.getElementById('moduleExplanationCard');
        const body = document.getElementById('moduleExplanationBody');
        const title = document.getElementById('moduleExplainTitle');
        if (card) card.classList.remove('hidden');
        if (title) title.innerText = `🤖 MODULE EXPLANATION: ${chosen.toUpperCase()}`;
        if (body) body.innerHTML = `<div class="llm-loading"><span class="spinner">⏳</span> Generating explanation for module '${chosen}' from static analysis context...</div>`;

        vscode.postMessage({
          command: 'requestModuleExplanation',
          moduleName: chosen
        });
      }
    });

    document.getElementById('closeModuleExplanation')?.addEventListener('click', () => {
      document.getElementById('moduleExplanationCard')?.classList.add('hidden');
    });

    document.getElementById('tabIntelligence')?.addEventListener('click', () => {
      this.switchTab('intelligence');
    });

    document.getElementById('tabTimeMachine')?.addEventListener('click', () => {
      this.switchTab('timeMachine');
    });

    document.getElementById('tabGraph')?.addEventListener('click', () => {
      this.switchTab('graph');
    });

    document.getElementById('btnExploreGraph')?.addEventListener('click', () => {
      this.switchTab('graph');
    });

    document.getElementById('btnFetchCommits')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'requestTimeMachineCommits' });
    });

    document.getElementById('btnCompareSnapshots')?.addEventListener('click', () => {
      const fromSelect = document.getElementById('selectFromCommit') as HTMLSelectElement;
      const toSelect = document.getElementById('selectToCommit') as HTMLSelectElement;
      const fromHash = fromSelect ? fromSelect.value : 'CURRENT_WORKING_TREE';
      const toHash = toSelect ? toSelect.value : 'CURRENT_WORKING_TREE';

      const fromItem = this.tmCommits.find(c => c.hash === fromHash);
      const toItem = this.tmCommits.find(c => c.hash === toHash);

      const resultsSection = document.getElementById('tmComparisonResultsSection');
      if (resultsSection) resultsSection.classList.remove('hidden');

      vscode.postMessage({
        command: 'requestCompareSnapshots',
        fromCommit: fromHash,
        toCommit: toHash,
        fromItem,
        toItem
      });
    });

    document.getElementById('btnExplainChange')?.addEventListener('click', () => {
      if (!this.activeComparison) {
        alert('Please run an architecture comparison first before generating an AI explanation.');
        return;
      }
      const card = document.getElementById('tmExplanationCard');
      const body = document.getElementById('tmExplanationBody');
      if (card) card.classList.remove('hidden');
      if (body) body.innerHTML = `<div class="llm-loading"><span class="spinner">⏳</span> Generating AI architecture change explanation from static diff...</div>`;

      vscode.postMessage({
        command: 'requestExplainChange',
        comparison: this.activeComparison
      });
    });

    document.getElementById('closeTmExplanation')?.addEventListener('click', () => {
      document.getElementById('tmExplanationCard')?.classList.add('hidden');
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget as HTMLButtonElement;
        target.classList.add('active');
        this.currentMode = target.dataset.mode as any;

        // Auto sync level slider based on mode
        if (this.currentMode === 'callgraph') {
          this.currentLevel = 4;
        } else if (this.currentMode === 'full') {
          this.currentLevel = 5;
        } else if (this.currentMode === 'architecture') {
          this.currentLevel = 2;
        }
        (document.getElementById('levelSlider') as HTMLInputElement).value = `${this.currentLevel}`;
        const levelLabels: Record<string, string> = {
          '1': '1 (Project / Modules)',
          '2': '2 (Files)',
          '3': '3 (Classes / Structs)',
          '4': '4 (Functions / Methods)',
          '5': '5 (Call Graph / Detailed)'
        };
        document.getElementById('levelValue')!.innerText = levelLabels[`${this.currentLevel}`];

        this.render();
        setTimeout(() => this.autoFitToContent(), 50);
      });
    });

    const levelSlider = document.getElementById('levelSlider') as HTMLInputElement;
    const levelValue = document.getElementById('levelValue') as HTMLElement;
    const levelLabels: Record<string, string> = {
      '1': '1 (Project / Modules)',
      '2': '2 (Files)',
      '3': '3 (Classes / Structs)',
      '4': '4 (Functions / Methods)',
      '5': '5 (Call Graph / Detailed)'
    };
    levelSlider.addEventListener('input', () => {
      this.currentLevel = parseInt(levelSlider.value, 10);
      levelValue.innerText = levelLabels[levelSlider.value];
      this.syncBreadcrumbToLevel(this.currentLevel);
      this.render();
      setTimeout(() => this.autoFitToContent(), 50);
    });

    const searchInput = document.getElementById('searchInput') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      this.searchTerm = searchInput.value.toLowerCase().trim();
      this.applySearchHighlight();
    });

    document.getElementById('btnRefresh')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'requestAnalysis' });
    });

    document.getElementById('btnResetView')?.addEventListener('click', () => {
      this.isFocusImpactMode = false;
      this.isComponentFocusActive = false;
      this.currentImpactResult = null;
      this.breadcrumbs = [{ id: 'root', label: 'Project', level: 1 }];
      this.currentLevel = 2;
      this.currentMode = 'architecture';
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.mode-btn[data-mode="architecture"]')?.classList.add('active');
      (document.getElementById('levelSlider') as HTMLInputElement).value = '2';
      document.getElementById('levelValue')!.innerText = '2 (Files)';
      document.getElementById('btnFocusImpact')?.classList.remove('active');
      this.render();
      this.autoFitToContent();
    });

    document.getElementById('zoomIn')?.addEventListener('click', () => {
      this.svg.transition().call(this.zoomBehavior.scaleBy, 1.3);
    });

    document.getElementById('zoomOut')?.addEventListener('click', () => {
      this.svg.transition().call(this.zoomBehavior.scaleBy, 0.7);
    });

    document.getElementById('zoomFit')?.addEventListener('click', () => {
      this.autoFitToContent();
    });

    document.getElementById('closeInspector')?.addEventListener('click', () => {
      document.getElementById('inspector')?.classList.add('collapsed');
      this.clearNodeSelection();
    });

    document.getElementById('btnJumpToSource')?.addEventListener('click', () => {
      if (this.selectedNode) {
        vscode.postMessage({
          command: 'navigateToFile',
          filePath: this.selectedNode.filePath,
          line: this.selectedNode.line
        });
      }
    });

    // Role Override Dropdown
    const roleSelect = document.getElementById('roleOverrideSelect') as HTMLSelectElement;
    roleSelect?.addEventListener('change', () => {
      if (this.selectedNode && roleSelect.value) {
        vscode.postMessage({
          command: 'overrideRole',
          entityId: this.selectedNode.id,
          newRole: roleSelect.value
        });
      }
    });

    // Impact Analysis Trigger
    document.getElementById('btnAnalyzeImpact')?.addEventListener('click', () => {
      this.triggerImpactAnalysis();
    });

    // Depth Selector Buttons (1, 2, 3, All)
    document.querySelectorAll('.depth-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.depth-btn').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget as HTMLButtonElement;
        target.classList.add('active');
        this.currentImpactDepth = target.dataset.depth || '2';
        this.triggerImpactAnalysis();
      });
    });

    // Focus Impact Sub-Graph Toggle
    document.getElementById('btnFocusImpact')?.addEventListener('click', () => {
      this.isFocusImpactMode = !this.isFocusImpactMode;
      const focusBtn = document.getElementById('btnFocusImpact');
      if (this.isFocusImpactMode) {
        focusBtn?.classList.add('active');
        focusBtn!.innerText = '🌐 Show Full Graph';
      } else {
        focusBtn?.classList.remove('active');
        focusBtn!.innerText = '🎯 Focus Impact Sub-Graph';
      }
      this.render();
      if (this.currentImpactResult) {
        this.applyImpactGraphHighlight(this.currentImpactResult);
      }
    });

    // Inspect Circular Dependency Cycle Button Listener
    document.getElementById('btnViewCycle')?.addEventListener('click', () => {
      this.inspectCycle(0);
    });
  }

  private triggerImpactAnalysis() {
    if (this.selectedNode) {
      vscode.postMessage({
        command: 'requestImpactAnalysis',
        entityId: this.selectedNode.id,
        depth: this.currentImpactDepth
      });
    }
  }

  private switchTab(tab: 'intelligence' | 'timeMachine' | 'graph') {
    this.currentTab = tab;
    const tabIntel = document.getElementById('tabIntelligence');
    const tabTm = document.getElementById('tabTimeMachine');
    const tabGraph = document.getElementById('tabGraph');
    const dashView = document.getElementById('dashboardView');
    const tmView = document.getElementById('timeMachineView');
    const graphView = document.getElementById('graphView');
    const graphOnlyEls = document.querySelectorAll('.graph-only');

    tabIntel?.classList.remove('active');
    tabTm?.classList.remove('active');
    tabGraph?.classList.remove('active');
    dashView?.classList.add('hidden');
    tmView?.classList.add('hidden');
    graphView?.classList.add('hidden');

    if (tab === 'intelligence') {
      tabIntel?.classList.add('active');
      dashView?.classList.remove('hidden');
      graphOnlyEls.forEach(el => el.classList.add('hidden'));
    } else if (tab === 'timeMachine') {
      tabTm?.classList.add('active');
      tmView?.classList.remove('hidden');
      graphOnlyEls.forEach(el => el.classList.add('hidden'));
      vscode.postMessage({ command: 'requestTimeMachineCommits' });
    } else {
      tabGraph?.classList.add('active');
      graphView?.classList.remove('hidden');
      graphOnlyEls.forEach(el => el.classList.remove('hidden'));
      setTimeout(() => this.autoFitToContent(), 50);
    }
  }

  private renderBreadcrumbs() {
    const nav = document.getElementById('breadcrumbBar');
    if (!nav) return;

    nav.innerHTML = '';

    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'crumb-root';
    rootCrumb.innerText = '📍 Project';
    rootCrumb.addEventListener('click', () => {
      this.breadcrumbs = [{ id: 'root', label: 'Project', level: 1 }];
      this.currentLevel = 1;
      (document.getElementById('levelSlider') as HTMLInputElement).value = '1';
      document.getElementById('levelValue')!.innerText = '1 (Project / Modules)';
      this.render();
      setTimeout(() => this.autoFitToContent(), 50);
    });
    nav.appendChild(rootCrumb);

    this.breadcrumbs.forEach((item, idx) => {
      if (item.id === 'root') return;

      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.innerText = '>';
      nav.appendChild(sep);

      const crumbEl = document.createElement('span');
      crumbEl.className = `crumb-item ${idx === this.breadcrumbs.length - 1 ? 'active' : ''}`;
      crumbEl.innerText = item.label;

      crumbEl.addEventListener('click', () => {
        this.breadcrumbs = this.breadcrumbs.slice(0, idx + 1);
        this.currentLevel = item.level;
        (document.getElementById('levelSlider') as HTMLInputElement).value = `${item.level}`;
        document.getElementById('levelValue')!.innerText = `${item.level}`;
        this.render();
        setTimeout(() => this.autoFitToContent(), 50);
      });

      nav.appendChild(crumbEl);
    });
  }

  private pushBreadcrumb(id: string, label: string, level: number) {
    this.breadcrumbs = this.breadcrumbs.filter(b => b.level < level);
    this.breadcrumbs.push({ id, label, level });
    this.renderBreadcrumbs();
  }

  private syncBreadcrumbToLevel(level: number) {
    this.breadcrumbs = this.breadcrumbs.filter(b => b.level <= level);
    if (this.breadcrumbs.length === 0) {
      this.breadcrumbs = [{ id: 'root', label: 'Project', level: 1 }];
    }
    this.renderBreadcrumbs();
  }

  private handleNodeDoubleClick(node: NodeItem) {
    if (this.currentLevel < 5) {
      this.currentLevel++;
    } else {
      this.currentLevel = 5;
    }

    const levelLabels: Record<string, string> = {
      '1': '1 (Project / Modules)',
      '2': '2 (Files)',
      '3': '3 (Classes / Structs)',
      '4': '4 (Functions / Methods)',
      '5': '5 (Call Graph / Detailed)'
    };

    (document.getElementById('levelSlider') as HTMLInputElement).value = `${this.currentLevel}`;
    document.getElementById('levelValue')!.innerText = levelLabels[`${this.currentLevel}`];

    this.pushBreadcrumb(node.id, node.name, this.currentLevel);
    this.selectNode(node);
    this.render();
    setTimeout(() => this.autoFitToContent(), 50);
  }

  private updateDashboard(data: GraphData) {
    const stats = data.stats;
    const entities = Object.values(data.entities);
    const files = entities.filter(e => e.kind === 'file');
    const archSummary = stats.architectureSummary;

    const dropdown = document.getElementById('moduleSelectDropdown') as HTMLSelectElement;
    if (dropdown) {
      const activeLayers = Array.from(new Set(entities.map(e => e.archLayer).filter(l => l && l !== 'unknown')));
      if (activeLayers.length > 0) {
        const currentValue = dropdown.value;
        dropdown.innerHTML = '';
        activeLayers.forEach(l => {
          const opt = document.createElement('option');
          opt.value = l;
          opt.textContent = `${l.toUpperCase()} Layer`;
          dropdown.appendChild(opt);
        });
        if (activeLayers.includes(currentValue)) {
          dropdown.value = currentValue;
        }
      }
    }

    let modelsCount = 0;
    let routesCount = 0;
    let controllersCount = 0;
    let defaultCount = 0;
    let entryCount = 0;

    files.forEach(f => {
      const name = f.name.toLowerCase();
      const layer = f.archLayer;

      if (name.includes('server') || name.includes('main') || name.includes('app.') || layer === 'config') {
        entryCount++;
      } else if (name.includes('route') || name.includes('endpoint') || layer === 'api') {
        routesCount++;
      } else if (name.includes('controller') || layer === 'controller') {
        controllersCount++;
      } else if (name.includes('model') || name.includes('repo') || name.includes('schema') || layer === 'model' || layer === 'repository') {
        modelsCount++;
      } else {
        defaultCount++;
      }
    });

    const digestTextEl = document.getElementById('digestText');
    if (digestTextEl) {
      const patternText = archSummary
        ? `Likely Pattern: ${archSummary.likelyPattern} (Confidence: ${archSummary.patternConfidence}%). ${archSummary.evidence}`
        : `This project consists of ${stats.totalFiles} files across ${stats.totalEntities} entities.`;

      const violText = archSummary && archSummary.violations.length > 0
        ? ` ⚠️ ${archSummary.violations.length} potential architecture violation(s) detected.`
        : ' Clean layer separation detected.';

      digestTextEl.innerText = `${patternText}${violText}`;
    }

    document.getElementById('metricTotalFiles')!.innerText = `${stats.totalFiles}`;
    document.getElementById('metricEdges')!.innerText = `${data.relationships.length}`;
    document.getElementById('metricUnreferenced')!.innerText = `${stats.unusedEntitiesCount || 0}`;

    const cycleCard = document.getElementById('cardCycles');
    const cycleMetric = document.getElementById('metricCycles');
    if (cycleMetric && cycleCard) {
      const cycleCount = stats.circularDependencies.length;
      cycleMetric.innerText = `${cycleCount}`;
      if (cycleCount > 0) {
        cycleCard.className = 'metric-card red-alert';
      } else {
        cycleCard.className = 'metric-card gray';
      }
    }

    const compGrid = document.getElementById('compositionGrid');
    if (compGrid) {
      compGrid.innerHTML = '';

      const compData = [
        { label: 'DEFAULT', val: defaultCount },
        { label: 'ENTRY', val: entryCount },
        { label: 'ROUTE', val: routesCount },
        { label: 'CONTROLLER', val: controllersCount },
        { label: 'MODEL', val: modelsCount }
      ];

      const maxVal = Math.max(1, ...compData.map(c => c.val));

      compData.forEach(c => {
        const pct = Math.round((c.val / maxVal) * 100);
        const card = document.createElement('div');
        card.className = 'comp-card';
        card.innerHTML = `
          <div class="comp-card-label">${c.label}</div>
          <div class="comp-card-val">${c.val}</div>
          <div class="comp-progress-bar" style="width: ${pct}%;"></div>
        `;
        compGrid.appendChild(card);
      });
    }

    // Quad Metrics Grid
    const hotspotsList = document.getElementById('hotspotsList');
    if (hotspotsList) {
      hotspotsList.innerHTML = '';
      const sortedByRefs = [...files].sort((a, b) => (b.metrics?.incomingDegree || 0) - (a.metrics?.incomingDegree || 0));
      const topHotspots = sortedByRefs.filter(f => (f.metrics?.incomingDegree || 0) > 0).slice(0, 5);

      if (topHotspots.length === 0) {
        hotspotsList.innerHTML = `<div class="quad-empty">No incoming dependencies detected yet.</div>`;
      } else {
        topHotspots.forEach(f => {
          const item = document.createElement('div');
          item.className = 'quad-item';
          item.innerHTML = `
            <span class="quad-code-pill" title="${f.relativePath}">${f.relativePath}</span>
            <span class="quad-val-badge green">${f.metrics?.incomingDegree || 1} refs</span>
          `;
          hotspotsList.appendChild(item);
        });
      }
    }

    const complexityList = document.getElementById('complexityList');
    if (complexityList) {
      complexityList.innerHTML = '';
      const sortedByComplexity = [...files].sort((a, b) => (b.metrics?.cyclomaticComplexity || b.metrics?.loc || 0) - (a.metrics?.cyclomaticComplexity || a.metrics?.loc || 0));
      const topComplexity = sortedByComplexity.slice(0, 5);

      if (topComplexity.length === 0) {
        complexityList.innerHTML = `<div class="quad-empty">No complexity data available.</div>`;
      } else {
        topComplexity.forEach(f => {
          const item = document.createElement('div');
          item.className = 'quad-item';
          const pts = f.metrics?.cyclomaticComplexity || Math.ceil((f.metrics?.loc || 1) / 10);
          item.innerHTML = `
            <span class="quad-code-pill" title="${f.relativePath}">${f.relativePath}</span>
            <span class="quad-val-badge cyan">${pts} pts</span>
          `;
          complexityList.appendChild(item);
        });
      }
    }

    const deadCodeList = document.getElementById('deadCodeList');
    if (deadCodeList) {
      deadCodeList.innerHTML = '';
      const unreferenced = files.filter(f => f.isUnused).slice(0, 5);

      if (unreferenced.length === 0) {
        deadCodeList.innerHTML = `<div class="quad-empty">No unreferenced components found.</div>`;
      } else {
        unreferenced.forEach(f => {
          const item = document.createElement('div');
          item.className = 'quad-item';
          item.innerHTML = `
            <span class="quad-code-pill" title="${f.relativePath}">${f.relativePath}</span>
          `;
          deadCodeList.appendChild(item);
        });
      }
    }

    const cyclesList = document.getElementById('cyclesList');
    if (cyclesList) {
      cyclesList.innerHTML = '';
      const cycles = stats.circularDependencies || [];
      const violations = archSummary?.violations || [];

      if (cycles.length === 0 && violations.length === 0) {
        cyclesList.innerHTML = `<div class="quad-empty">Clean, acyclic flow detected.</div>`;
      } else {
        cycles.forEach((c, idx) => {
          const item = document.createElement('div');
          item.className = 'quad-item clickable';
          item.style.cursor = 'pointer';
          const namesStr = c.cycleNames.join(' ➔ ');
          item.innerHTML = `
            <span class="quad-code-pill" title="${namesStr}">🔄 ${namesStr}</span>
          `;
          item.addEventListener('click', () => {
            this.inspectCycle(idx);
          });
          cyclesList.appendChild(item);
        });

        violations.forEach(v => {
          const item = document.createElement('div');
          item.className = 'quad-item';
          item.innerHTML = `
            <span class="quad-code-pill" title="${v.description}">⚠️ ${v.sourceName} ➔ ${v.targetName}</span>
          `;
          cyclesList.appendChild(item);
        });
      }
    }
  }

  private render() {
    if (!this.rawGraphData) return;

    this.renderBreadcrumbs();

    let { nodes, links } = this.filterAndLayoutGraphData(this.rawGraphData);

    if (this.isComponentFocusActive && this.selectedNode) {
      const focusId = this.selectedNode.id;
      const connectedIds = new Set<string>([focusId]);

      links.forEach(l => {
        const sId = typeof l.source === 'string' ? l.source : (l.source as NodeItem).id;
        const tId = typeof l.target === 'string' ? l.target : (l.target as NodeItem).id;
        if (sId === focusId) connectedIds.add(tId);
        if (tId === focusId) connectedIds.add(sId);
      });

      nodes = nodes.filter(n => connectedIds.has(n.id));
      links = links.filter(l => {
        const sId = typeof l.source === 'string' ? l.source : (l.source as NodeItem).id;
        const tId = typeof l.target === 'string' ? l.target : (l.target as NodeItem).id;
        return connectedIds.has(sId) && connectedIds.has(tId);
      });
    }

    if (this.isFocusImpactMode && this.currentImpactResult) {
      const allowedIds = new Set([
        this.currentImpactResult.targetEntity.id,
        ...(this.currentImpactResult.allAffectedEntityIds || [])
      ]);
      nodes = nodes.filter(n => allowedIds.has(n.id));
      links = links.filter(l => allowedIds.has(typeof l.source === 'string' ? l.source : (l.source as NodeItem).id) && allowedIds.has(typeof l.target === 'string' ? l.target : (l.target as NodeItem).id));
    }

    this.containerGroup.selectAll('*').remove();

    // Render Architecture Category Swimlane Headers if in Architecture View mode
    if (this.currentMode === 'architecture') {
      const swimlaneHeaders = [
        { col: 0, title: 'ENTRY & CONFIG 🚀' },
        { col: 1, title: 'PRESENTATION & API 🌐' },
        { col: 2, title: 'BUSINESS LOGIC ⚙️' },
        { col: 3, title: 'DATA ACCESS & MODELS 🗄️' }
      ];

      const headerGroup = this.containerGroup.append('g').attr('class', 'swimlane-headers');

      swimlaneHeaders.forEach(sh => {
        const xPos = sh.col * 300;
        headerGroup.append('rect')
          .attr('x', xPos - 110)
          .attr('y', -240)
          .attr('width', 220)
          .attr('height', 30)
          .attr('rx', 15)
          .attr('ry', 15)
          .attr('fill', 'rgba(0, 132, 255, 0.12)')
          .attr('stroke', '#0084ff')
          .attr('stroke-width', 1.5);

        headerGroup.append('text')
          .attr('x', xPos)
          .attr('y', -220)
          .attr('text-anchor', 'middle')
          .attr('fill', '#00bcff')
          .attr('font-size', '11px')
          .attr('font-weight', '800')
          .attr('letter-spacing', '0.8px')
          .text(sh.title);
      });
    }

    const nodeMap = new Map<string, NodeItem>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    links.forEach(l => {
      if (typeof l.source === 'string') l.source = nodeMap.get(l.source as string)!;
      if (typeof l.target === 'string') l.target = nodeMap.get(l.target as string)!;
    });

    const cardWidth = 170;
    const cardHeight = 38;

    // Render Edges
    const linkGroup = this.containerGroup.append('g').attr('class', 'links');
    
    links.forEach(l => {
      const s = l.source as NodeItem;
      const t = l.target as NodeItem;
      if (!s || !t) return;

      const startX = (s.x || 0) + cardWidth / 2;
      const startY = s.y || 0;
      const endX = (t.x || 0) - cardWidth / 2;
      const endY = t.y || 0;
      const midX = (startX + endX) / 2;

      const status = (l as any).trafficStatus || 'healthy';
      const edgeColor = status === 'violation' ? '#ff4d4f' : status === 'warning' ? '#f1c40f' : '#2ecc71';
      const badgeBg = status === 'violation' ? '#ff4d4f' : status === 'warning' ? '#f1c40f' : '#ffffff';
      const badgeTextCol = status === 'violation' ? '#ffffff' : status === 'warning' ? '#11111b' : '#11111b';

      const edgeGroup = linkGroup.append('g').attr('class', 'edge-group');

      const pathD = `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;

      edgeGroup.append('path')
        .attr('class', 'graph-edge')
        .attr('d', pathD)
        .attr('stroke', edgeColor)
        .attr('stroke-width', status === 'violation' ? 2.5 : 1.8)
        .attr('stroke-dasharray', status === 'violation' ? 'none' : '4,4')
        .attr('fill', 'none');

      const badgeWidth = 66;
      const badgeHeight = 18;

      edgeGroup.append('rect')
        .attr('x', midX - badgeWidth / 2)
        .attr('y', ((startY + endY) / 2) - badgeHeight / 2)
        .attr('width', badgeWidth)
        .attr('height', badgeHeight)
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', badgeBg)
        .attr('stroke', '#11111b')
        .attr('stroke-width', 0.5);

      const statusIcon = status === 'violation' ? '🔴 ' : status === 'warning' ? '🟡 ' : '🟢 ';
      edgeGroup.append('text')
        .attr('x', midX)
        .attr('y', ((startY + endY) / 2) + 3.5)
        .attr('text-anchor', 'middle')
        .attr('fill', badgeTextCol)
        .attr('font-size', '10px')
        .attr('font-weight', 'bold')
        .attr('font-family', 'sans-serif')
        .text(`${statusIcon}${l.kind.toLowerCase()}`);
    });

    // Render Nodes
    const nodeGroup = this.containerGroup.append('g').attr('class', 'nodes');

    const nodeElements = nodeGroup.selectAll<SVGGElement, NodeItem>('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node-card')
      .attr('id', d => `node-card-${d.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`)
      .attr('transform', d => `translate(${d.x || 0},${d.y || 0})`)
      .call(d3.drag<SVGGElement, NodeItem>()
        .on('drag', (event, d) => {
          d.x = event.x;
          d.y = event.y;
          d3.select(event.sourceEvent.target.closest('.node-card'))
            .attr('transform', `translate(${d.x},${d.y})`);
          this.repositionEdges(nodes, links);
        })
      );

    // Single Click Node Handler
    nodeElements.on('click', (event, d) => {
      event.stopPropagation();
      this.selectNode(d);
    });

    nodeElements.append('rect')
      .attr('class', 'pill-rect')
      .attr('x', -cardWidth / 2)
      .attr('y', -cardHeight / 2)
      .attr('width', cardWidth)
      .attr('height', cardHeight)
      .attr('rx', cardHeight / 2)
      .attr('ry', cardHeight / 2)
      .attr('fill', d => this.getPillColor(d))
      .attr('stroke', d => {
        const ent = this.rawGraphData?.entities[d.id];
        const status = ent?.healthStatus || 'healthy';
        if (status === 'violation') return '#ff4d4f';
        if (status === 'warning') return '#f1c40f';
        if (d.isUnused) return '#f38ba8';
        return 'rgba(255, 255, 255, 0.25)';
      })
      .attr('stroke-width', d => {
        const ent = this.rawGraphData?.entities[d.id];
        return ent?.healthStatus === 'violation' ? 3 : 1.5;
      });

    // Traffic Light Badge Indicator Dot on Node Card
    nodeElements.append('circle')
      .attr('cx', cardWidth / 2 - 12)
      .attr('cy', -cardHeight / 2 + 8)
      .attr('r', 5)
      .attr('fill', d => {
        const ent = this.rawGraphData?.entities[d.id];
        const status = ent?.healthStatus || 'healthy';
        return status === 'violation' ? '#ff4d4f' : status === 'warning' ? '#f1c40f' : '#2ecc71';
      })
      .attr('stroke', '#11111b')
      .attr('stroke-width', 1);

    nodeElements.append('circle')
      .attr('cx', -cardWidth / 2)
      .attr('cy', 0)
      .attr('r', 4)
      .attr('fill', '#ffffff')
      .attr('stroke', '#11111b')
      .attr('stroke-width', 1.5);

    nodeElements.append('circle')
      .attr('cx', cardWidth / 2)
      .attr('cy', 0)
      .attr('r', 4)
      .attr('fill', '#ffffff')
      .attr('stroke', '#11111b')
      .attr('stroke-width', 1.5);

    nodeElements.append('text')
      .attr('x', 0)
      .attr('y', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', '#ffffff')
      .attr('font-size', '13px')
      .attr('font-weight', '700')
      .attr('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')
      .attr('pointer-events', 'none')
      .text(d => (d.name.length > 20 ? d.name.slice(0, 18) + '...' : d.name));

    this.applySearchHighlight();

    if (this.currentTab === 'graph') {
      setTimeout(() => {
        this.autoFitToContent();
      }, 50);
    }
  }

  private filterAndLayoutGraphData(graphData: GraphData): { nodes: NodeItem[]; links: LinkItem[] } {
    const rawEntities = Object.values(graphData.entities);
    const activeBreadcrumb = this.breadcrumbs[this.breadcrumbs.length - 1];
    const activeParentId = activeBreadcrumb && activeBreadcrumb.id !== 'root' ? activeBreadcrumb.id : null;

    let filteredEntities: IREntity[] = [];

    if (activeParentId) {
      const parentEntity = rawEntities.find(e => e.id === activeParentId);
      filteredEntities = rawEntities.filter(e =>
        e.id === activeParentId ||
        e.parentId === activeParentId ||
        (parentEntity && e.filePath === parentEntity.filePath)
      );
      if (filteredEntities.length <= 1) {
        filteredEntities = rawEntities;
      }
    } else {
      if (this.currentMode === 'callgraph') {
        filteredEntities = rawEntities.filter(e => e.kind === 'function' || e.kind === 'method' || e.kind === 'class' || e.kind === 'interface');
      } else if (this.currentMode === 'full') {
        filteredEntities = rawEntities;
      } else if (this.currentLevel === 1) {
        filteredEntities = rawEntities.filter(e => e.kind === 'file' && (e.relativePath.split(/[/\\]/).length <= 2 || e.name.toLowerCase().includes('main') || e.name.toLowerCase().includes('app')));
      } else if (this.currentLevel === 2) {
        filteredEntities = rawEntities.filter(e => e.kind === 'file');
      } else if (this.currentLevel === 3) {
        filteredEntities = rawEntities.filter(e => e.kind === 'file' || e.kind === 'class' || e.kind === 'interface' || e.kind === 'struct');
      } else if (this.currentLevel === 4) {
        filteredEntities = rawEntities.filter(e => e.kind === 'file' || e.kind === 'class' || e.kind === 'interface' || e.kind === 'function' || e.kind === 'method');
      } else {
        filteredEntities = rawEntities;
      }
    }

    const nodeSet = new Set(filteredEntities.map(e => e.id));

    const nodes: NodeItem[] = filteredEntities.map(e => {
      const col = this.determineColumn(e);
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        language: e.language,
        filePath: e.filePath,
        line: e.location.startLine,
        archLayer: e.archLayer,
        archConfidence: e.archConfidence,
        metrics: e.metrics,
        isUnused: e.isUnused,
        column: col,
        row: 0
      };
    });

    const columnGroups: Record<number, NodeItem[]> = {};
    nodes.forEach(n => {
      if (!columnGroups[n.column]) columnGroups[n.column] = [];
      columnGroups[n.column].push(n);
    });

    const columnXSpacing = 300;
    const rowYSpacing = 65;

    Object.keys(columnGroups).forEach(colStr => {
      const col = parseInt(colStr, 10);
      const colNodes = columnGroups[col];
      const startY = -(colNodes.length - 1) * (rowYSpacing / 2);

      colNodes.forEach((n, idx) => {
        n.row = idx;
        n.x = col * columnXSpacing;
        n.y = startY + idx * rowYSpacing;
      });
    });

    // Link filtering based on mode
    const links: LinkItem[] = graphData.relationships
      .filter(r => nodeSet.has(r.sourceId) && nodeSet.has(r.targetId))
      .filter(r => {
        if (this.currentMode === 'dependencies') {
          return r.kind === 'IMPORTS' || r.kind === 'REFERENCES' || r.kind === 'DEPENDS_ON';
        }
        if (this.currentMode === 'callgraph') {
          return r.kind === 'CALLS' || r.kind === 'EXTENDS' || r.kind === 'IMPLEMENTS';
        }
        return true;
      })
      .map(r => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        kind: r.kind,
        certainty: r.certainty
      }));

    return { nodes, links };
  }

  private determineColumn(entity: IREntity): number {
    const nameLower = entity.name.toLowerCase();
    const layer = entity.archLayer;

    if (layer === 'config' || nameLower.includes('server') || nameLower.includes('main') || nameLower.includes('app.') || nameLower.includes('index.')) {
      return 0; // ENTRY & CONFIG
    }
    if (layer === 'controller' || layer === 'api' || layer === 'view' || nameLower.includes('route') || nameLower.includes('endpoint') || nameLower.includes('handler')) {
      return 1; // PRESENTATION & API
    }
    if (layer === 'service' || nameLower.includes('service') || nameLower.includes('usecase') || nameLower.includes('logic')) {
      return 2; // BUSINESS LOGIC
    }
    if (layer === 'repository' || layer === 'model' || layer === 'db' || nameLower.includes('repo') || nameLower.includes('model') || nameLower.includes('schema')) {
      return 3; // DATA ACCESS & MODELS
    }
    return 1;
  }

  private getPillColor(node: NodeItem): string {
    const irEntity = this.rawGraphData?.entities[node.id] as any;
    const diffStatus = (node as any).diffStatus || irEntity?.diffStatus;

    if (diffStatus === 'added') return '#1e824c';
    if (diffStatus === 'removed') return '#96281b';
    if (diffStatus === 'modified') return '#d35400';

    const nameLower = node.name.toLowerCase();

    if (nameLower.includes('server') || nameLower.includes('main') || nameLower.includes('app.')) {
      return '#e74c3c';
    }
    if (nameLower.includes('route')) {
      return '#9b59b6';
    }
    if (nameLower.includes('auth')) {
      return '#8e44ad';
    }
    if (nameLower.includes('controller') || node.archLayer === 'controller') {
      return '#3498db';
    }
    if (nameLower.includes('service') || node.archLayer === 'service') {
      return '#2980b9';
    }
    if (nameLower.includes('model') || nameLower.includes('repo') || node.archLayer === 'model' || node.archLayer === 'repository') {
      return '#e67e22';
    }
    if (node.archLayer === 'view' || nameLower.includes('nav')) {
      return '#4a5568';
    }
    return '#34495e';
  }

  private repositionEdges(nodes: NodeItem[], links: LinkItem[]) {
    const nodeMap = new Map<string, NodeItem>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    const cardWidth = 170;

    this.containerGroup.selectAll('.edge-group').each(function(d: any, i) {
      const l = links[i];
      if (!l) return;
      const s = typeof l.source === 'string' ? nodeMap.get(l.source) : l.source as NodeItem;
      const t = typeof l.target === 'string' ? nodeMap.get(l.target) : l.target as NodeItem;
      if (!s || !t) return;

      const startX = (s.x || 0) + cardWidth / 2;
      const startY = s.y || 0;
      const endX = (t.x || 0) - cardWidth / 2;
      const endY = t.y || 0;
      const midX = (startX + endX) / 2;

      const pathD = `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;

      d3.select(this).select('path').attr('d', pathD);
      d3.select(this).select('rect').attr('x', midX - 26).attr('y', ((startY + endY) / 2) - 9);
      d3.select(this).select('text').attr('x', midX).attr('y', ((startY + endY) / 2) + 3.5);
    });
  }

  private selectNode(node: NodeItem) {
    this.selectedNode = node;
    const inspector = document.getElementById('inspector');
    if (!inspector) return;

    try {
      this.pushBreadcrumb(node.id, node.name, this.currentLevel);

      this.containerGroup.selectAll('.pill-rect')
        .attr('stroke', 'rgba(255, 255, 255, 0.25)')
        .attr('stroke-width', 1.5);

      const safeId = node.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      d3.select(`#node-card-${safeId} .pill-rect`)
        .attr('stroke', '#00bcff')
        .attr('stroke-width', 3.5);

      // Section 1: Overview DOM
      const inspectNameEl = document.getElementById('inspectName');
      const inspectKindEl = document.getElementById('inspectKind');
      const inspectLangEl = document.getElementById('inspectLang');
      const inspectLayerEl = document.getElementById('inspectLayer');
      const inspectOverviewTypeEl = document.getElementById('inspectOverviewType');
      const inspectFileEl = document.getElementById('inspectFile');
      const inspectModuleEl = document.getElementById('inspectModule');
      const inspectDependenciesCountEl = document.getElementById('inspectDependenciesCount');
      const inspectDependentsCountEl = document.getElementById('inspectDependentsCount');

      if (inspectNameEl) inspectNameEl.innerText = node.name || 'Component';
      if (inspectKindEl) inspectKindEl.innerText = node.kind || 'Entity';
      if (inspectLangEl) inspectLangEl.innerText = node.language || 'Code';
      if (inspectLayerEl) inspectLayerEl.innerText = node.archLayer || 'unknown';
      if (inspectOverviewTypeEl) inspectOverviewTypeEl.innerText = node.kind || 'Component';

      const filePathStr = node.filePath || '';
      if (inspectFileEl) inspectFileEl.innerText = filePathStr ? (filePathStr.split(/[/\\]/).pop() || filePathStr) : '-';
      if (inspectModuleEl) inspectModuleEl.innerText = filePathStr ? (filePathStr.split(/[/\\]/)[0] || node.archLayer || 'Module') : (node.archLayer || 'Module');

      const irEntity = this.rawGraphData?.entities[node.id];
      const depCount = node.metrics?.outgoingDegree ?? (irEntity?.imports?.length || 0);
      const deptCount = node.metrics?.incomingDegree ?? 0;

      if (inspectDependenciesCountEl) inspectDependenciesCountEl.innerText = `${depCount}`;
      if (inspectDependentsCountEl) inspectDependentsCountEl.innerText = `${deptCount}`;

      // Section 4: Static Node Analysis & Insights DOM
      const inspectLinesEl = document.getElementById('inspectLines');
      const inspectComplexityEl = document.getElementById('inspectComplexity');
      const inspectIncomingEl = document.getElementById('inspectIncoming');
      const inspectOutgoingEl = document.getElementById('inspectOutgoing');

      if (inspectLinesEl) inspectLinesEl.innerText = `${node.metrics?.loc || 1} lines`;
      if (inspectComplexityEl) inspectComplexityEl.innerText = `${node.metrics?.cyclomaticComplexity || 1}`;
      if (inspectIncomingEl) inspectIncomingEl.innerText = `${deptCount}`;
      if (inspectOutgoingEl) inspectOutgoingEl.innerText = `${depCount}`;

      const insightsBox = document.getElementById('inspectInsightsBox');
      if (insightsBox) {
        const insights: string[] = [];
        if (irEntity?.isUnused) insights.push('⚠️ Unreferenced component (0 incoming references across workspace).');
        if (deptCount > 3) insights.push(`🔥 High dependency hotspot (${deptCount} incoming dependents).`);
        if (depCount > 3) insights.push(`🔗 High outgoing coupling (depends on ${depCount} components).`);
        if ((node.metrics?.cyclomaticComplexity || 1) > 3) insights.push(`🧠 Elevated complexity (${node.metrics?.cyclomaticComplexity} logic branches).`);
        insights.push(`🏛️ Classified under '${node.archLayer || 'unknown'}' architectural layer.`);

        insightsBox.innerHTML = insights.map(i => `<div class="insight-item"><span class="insight-bullet">•</span> ${i}</div>`).join('');
      }

      // Section 5: Architecture Information DOM
      const archLayerEl = document.getElementById('archInfoLayer');
      const archKindEl = document.getElementById('archInfoKind');
      const archRoleEl = document.getElementById('archInfoRole');
      const inspectConfidenceEl = document.getElementById('inspectConfidence');

      if (archLayerEl) archLayerEl.innerText = node.archLayer || 'unknown';
      if (archKindEl) archKindEl.innerText = node.kind || 'Component';
      if (archRoleEl) archRoleEl.innerText = `${(node.archLayer || 'General').toUpperCase()} Layer Component`;
      if (inspectConfidenceEl) inspectConfidenceEl.innerText = `${irEntity?.archConfidence || 90}%`;

      const statusBadge = document.getElementById('inspectTraffic');
      const statusReasonEl = document.getElementById('inspectStatusReason');
      if (statusBadge) {
        const hStatus = irEntity?.healthStatus || 'healthy';
        if (hStatus === 'violation') {
          statusBadge.className = 'badge status-violation';
          statusBadge.innerText = '🔴 Violation';
        } else if (hStatus === 'warning') {
          statusBadge.className = 'badge status-warning';
          statusBadge.innerText = '🟡 Concern';
        } else {
          statusBadge.className = 'badge status-healthy';
          statusBadge.innerText = '🟢 Healthy';
        }
      }
      if (statusReasonEl) {
        statusReasonEl.innerText = irEntity?.statusReason || 'Healthy architectural dependency flow.';
      }

      const roleSelect = document.getElementById('roleOverrideSelect') as HTMLSelectElement;
      if (roleSelect && node.archLayer) {
        roleSelect.value = node.archLayer;
      }

      // Section 7: GitHub Analysis Request
      if (node.filePath) {
        vscode.postMessage({
          command: 'requestGitHistory',
          filePath: node.filePath,
          entityId: node.id
        });
      }

      // Section 6: Relationship Analysis (Imports & Exports) DOM
      const imports = irEntity?.imports || [];
      const exports = irEntity?.exports || [];

      const importsCountEl = document.getElementById('inspectImportsCount');
      const importsListEl = document.getElementById('inspectImportsList');
      if (importsCountEl && importsListEl) {
        importsCountEl.innerText = `(${imports.length})`;
        importsListEl.innerHTML = '';

        if (imports.length === 0) {
          importsListEl.innerHTML = `<li class="empty-state">No direct imports found for this entity.</li>`;
        } else {
          imports.forEach(imp => {
            const li = document.createElement('li');
            li.className = 'inspector-item';
            li.innerHTML = `
              <span class="item-bullet">•</span>
              <span class="item-symbol">${imp.symbol}</span>
              <span class="item-module">${imp.sourceModule || ''}</span>
            `;

            li.addEventListener('click', (e) => {
              e.stopPropagation();
              const allEntities = Object.values(this.rawGraphData?.entities || {});
              const targetEntity = allEntities.find(e =>
                e.name.toLowerCase() === imp.symbol.toLowerCase() ||
                (e.relativePath && e.relativePath.toLowerCase().includes(imp.symbol.toLowerCase())) ||
                (imp.sourceModule && e.relativePath && e.relativePath.toLowerCase().includes(imp.sourceModule.toLowerCase()))
              );

              if (targetEntity) {
                const targetNode: NodeItem = {
                  id: targetEntity.id,
                  name: targetEntity.name,
                  kind: targetEntity.kind,
                  language: targetEntity.language,
                  filePath: targetEntity.filePath,
                  line: targetEntity.location?.startLine || 1,
                  archLayer: targetEntity.archLayer,
                  archConfidence: targetEntity.archConfidence,
                  metrics: targetEntity.metrics,
                  column: this.determineColumn(targetEntity),
                  row: 0
                };
                this.selectNode(targetNode);
              }

              if (node.filePath) {
                vscode.postMessage({
                  command: 'navigateToFile',
                  filePath: node.filePath,
                  line: imp.location?.startLine || node.line
                });
              }
            });

            importsListEl.appendChild(li);
          });
        }
      }

      const exportsCountEl = document.getElementById('inspectExportsCount');
      const exportsListEl = document.getElementById('inspectExportsList');
      if (exportsCountEl && exportsListEl) {
        exportsCountEl.innerText = `(${exports.length})`;
        exportsListEl.innerHTML = '';

        if (exports.length === 0) {
          exportsListEl.innerHTML = `<li class="empty-state">No exports found for this entity.</li>`;
        } else {
          exports.forEach(exp => {
            const li = document.createElement('li');
            li.className = 'inspector-item';
            li.innerHTML = `
              <span class="item-bullet">•</span>
              <span class="item-symbol">${exp.symbol}</span>
              <span class="item-module">${exp.kind || ''}</span>
            `;

            li.addEventListener('click', (e) => {
              e.stopPropagation();
              if (node.filePath) {
                vscode.postMessage({
                  command: 'navigateToFile',
                  filePath: node.filePath,
                  line: exp.location?.startLine || node.line
                });
              }
            });

            exportsListEl.appendChild(li);
          });
        }
      }

      document.getElementById('impactResultsPanel')?.classList.add('hidden');

      // Section 3: AI Explanation with Cache Check
      const llmPanel = document.getElementById('llmExplanationPanel');
      const llmSpinner = document.getElementById('llmLoadingSpinner');
      const llmResults = document.getElementById('llmExplanationResults');
      if (llmPanel) llmPanel.classList.remove('hidden');

      if (this.nodeExplanationCache.has(node.id)) {
        if (llmSpinner) llmSpinner.classList.add('hidden');
        if (llmResults) llmResults.innerHTML = this.buildExplanationHtml(this.nodeExplanationCache.get(node.id));
      } else {
        if (llmSpinner) llmSpinner.classList.remove('hidden');
        if (llmResults) llmResults.innerHTML = '';

        vscode.postMessage({
          command: 'requestNodeExplanation',
          entityId: node.id
        });
      }
    } catch (err) {
      console.warn('Error in selectNode:', err);
    } finally {
      inspector.classList.remove('collapsed');
    }
  }

  private renderNodeExplanation(entityId: string, explanation: any) {
    if (explanation) {
      this.nodeExplanationCache.set(entityId, explanation);
    }
    const spinner = document.getElementById('llmLoadingSpinner');
    const results = document.getElementById('llmExplanationResults');
    if (spinner) spinner.classList.add('hidden');
    if (!results || !explanation) return;

    if (this.selectedNode && this.selectedNode.id === entityId) {
      results.innerHTML = this.buildExplanationHtml(explanation);
    }
  }

  private renderModuleExplanation(moduleName: string, explanation: any) {
    if (explanation) {
      this.moduleExplanationCache.set(moduleName, explanation);
    }
    const body = document.getElementById('moduleExplanationBody');
    if (!body || !explanation) return;

    body.innerHTML = this.buildExplanationHtml(explanation);
  }

  private buildExplanationHtml(explanation: any): string {
    let html = `
      <div class="llm-explanation-summary">
        <strong>${this.escapeHtml(explanation.title || 'Explanation')}</strong><br/>
        ${this.escapeHtml(explanation.summary || '')}
      </div>
    `;

    if (Array.isArray(explanation.sections)) {
      explanation.sections.forEach((sec: any) => {
        html += `
          <div class="llm-section-card">
            <div class="llm-section-heading">${this.escapeHtml(sec.heading)}</div>
            <div class="llm-section-body">${this.escapeHtml(sec.content)}</div>
          </div>
        `;
      });
    }

    if (Array.isArray(explanation.limitations) && explanation.limitations.length > 0) {
      html += `<div class="llm-limitations-box">`;
      explanation.limitations.forEach((lim: string) => {
        html += `
          <div class="limitation-item">
            <span class="limitation-pill">Notice</span>
            <span>${this.escapeHtml(lim)}</span>
          </div>
        `;
      });
      html += `</div>`;
    }

    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private renderGitEvolution(evolution: any) {
    const gitUnavailMsg = document.getElementById('gitUnavailableMsg');
    const gitMetricsContainer = document.getElementById('gitMetricsContainer');

    if (!evolution || !evolution.totalCommits || evolution.totalCommits === 0) {
      if (gitUnavailMsg) gitUnavailMsg.classList.remove('hidden');
      if (gitMetricsContainer) gitMetricsContainer.classList.add('hidden');
      return;
    }

    if (gitUnavailMsg) gitUnavailMsg.classList.add('hidden');
    if (gitMetricsContainer) gitMetricsContainer.classList.remove('hidden');

    document.getElementById('gitCreatedYear')!.innerText = `${evolution.createdYear || '2024'}`;
    document.getElementById('gitCommitsCount')!.innerText = `${evolution.totalCommits || 1}`;
    document.getElementById('gitLastModified')!.innerText = `${evolution.lastModifiedRelative || 'recently'}`;
    document.getElementById('gitCoChangedCount')!.innerText = `${evolution.coChangedFilesCount || 0}`;

    // Render Commit Timeline Trail
    const commitListEl = document.getElementById('gitCommitList');
    if (commitListEl) {
      commitListEl.innerHTML = '';
      const commits = evolution.recentCommits || [];

      if (commits.length === 0) {
        commitListEl.innerHTML = `<li class="empty-state">No commit timeline history available.</li>`;
      } else {
        commits.forEach((c: any) => {
          const li = document.createElement('li');
          li.className = 'git-commit-item';
          li.innerHTML = `
            <div class="commit-meta">
              <span class="commit-author">${c.author}</span>
              <span class="commit-date">${c.relativeDate}</span>
            </div>
            <div class="commit-msg" title="${c.message}">${c.shortHash}: ${c.message}</div>
          `;

          li.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.selectedNode) {
              vscode.postMessage({
                command: 'navigateToFile',
                filePath: this.selectedNode.filePath,
                line: this.selectedNode.line
              });
            }
          });

          commitListEl.appendChild(li);
        });
      }
    }

    // Render Co-Changed Files (Coupling)
    const couplingListEl = document.getElementById('gitCoChangedList');
    if (couplingListEl) {
      couplingListEl.innerHTML = '';
      const coFiles = evolution.topCoChangedFiles || [];

      if (coFiles.length === 0) {
        couplingListEl.innerHTML = `<span class="empty-state">No co-changed coupling detected.</span>`;
      } else {
        coFiles.forEach((f: any) => {
          const span = document.createElement('span');
          span.className = 'coupling-pill';
          span.innerText = `${f.name} (${f.coChangeCount}x)`;
          span.title = f.filePath;

          span.addEventListener('click', (e) => {
            e.stopPropagation();
            const allEntities = Object.values(this.rawGraphData?.entities || {});
            const target = allEntities.find(e => e.relativePath.toLowerCase().includes(f.name.toLowerCase()));

            if (target) {
              const targetNode: NodeItem = {
                id: target.id,
                name: target.name,
                kind: target.kind,
                language: target.language,
                filePath: target.filePath,
                line: target.location.startLine,
                archLayer: target.archLayer,
                archConfidence: target.archConfidence,
                metrics: target.metrics,
                column: this.determineColumn(target),
                row: 0
              };
              this.selectNode(targetNode);
            }
          });

          couplingListEl.appendChild(span);
        });
      }
    }
  }

  private clearNodeSelection() {
    this.selectedNode = null;
    this.containerGroup.selectAll('.pill-rect')
      .attr('stroke', 'rgba(255, 255, 255, 0.25)')
      .attr('stroke-width', 1.5);
  }

  private renderImpactResults(impact: any) {
    const panel = document.getElementById('impactResultsPanel');
    if (!panel || !impact) return;

    panel.classList.remove('hidden');

    const scoreBadge = document.getElementById('impactScoreBadge');
    const explanationEl = document.getElementById('impactScoreExplanation');
    if (scoreBadge && explanationEl) {
      scoreBadge.innerText = `${impact.impactScore} / 100`;
      const b = impact.scoreBreakdown;
      explanationEl.innerText = `Based on: ${b.directCount} direct, ${b.indirectCount} indirect dependents across ${b.layersCrossed} architectural layer(s).`;
    }

    const directCountEl = document.getElementById('directImpactCount');
    const directListEl = document.getElementById('directImpactList');
    if (directCountEl && directListEl) {
      directCountEl.innerText = `(${impact.directImpact.length})`;
      directListEl.innerHTML = '';

      if (impact.directImpact.length === 0) {
        directListEl.innerHTML = `<li class="empty-state">No statically detected dependents.</li>`;
      } else {
        impact.directImpact.forEach((item: any) => {
          const card = document.createElement('li');
          card.className = 'impact-card-item';

          const pathStr = item.path.map((p: any) => `${p.fromName} ➔ ${p.relKind} ➔ ${p.toName}`).join('<br/>');

          card.innerHTML = `
            <div class="impact-card-header">
              <span class="impact-card-name">${item.entity.name}</span>
              <span class="impact-rel-badge">${item.relKind}</span>
            </div>
            <div class="impact-path-box">
              <div class="impact-path-title">WHY IS THIS AFFECTED?</div>
              <div>${pathStr}</div>
            </div>
          `;

          card.addEventListener('click', (e) => {
            e.stopPropagation();

            const targetNode: NodeItem = {
              id: item.entity.id,
              name: item.entity.name,
              kind: item.entity.kind,
              language: item.entity.language,
              filePath: item.entity.filePath,
              line: item.entity.location.startLine,
              archLayer: item.entity.archLayer,
              archConfidence: item.entity.archConfidence,
              metrics: item.entity.metrics,
              column: this.determineColumn(item.entity),
              row: 0
            };
            this.selectNode(targetNode);

            vscode.postMessage({
              command: 'navigateToFile',
              filePath: item.entity.filePath,
              line: item.entity.location.startLine
            });
          });

          directListEl.appendChild(card);
        });
      }
    }

    const indirectCountEl = document.getElementById('indirectImpactCount');
    const indirectListEl = document.getElementById('indirectImpactList');
    if (indirectCountEl && indirectListEl) {
      indirectCountEl.innerText = `(${impact.indirectImpact.length})`;
      indirectListEl.innerHTML = '';

      if (impact.indirectImpact.length === 0) {
        indirectListEl.innerHTML = `<li class="empty-state">No indirect dependents detected.</li>`;
      } else {
        impact.indirectImpact.forEach((item: any) => {
          const card = document.createElement('li');
          card.className = 'impact-card-item';

          const pathStr = item.path.map((p: any) => `${p.fromName} ➔ ${p.relKind} ➔ ${p.toName}`).join(' ➔ ');

          card.innerHTML = `
            <div class="impact-card-header">
              <span class="impact-card-name">${item.entity.name}</span>
              <span class="impact-rel-badge">Depth ${item.depth}</span>
            </div>
            <div class="impact-path-box">
              <div class="impact-path-title">DEPENDENCY PATH:</div>
              <div>${pathStr}</div>
            </div>
          `;

          card.addEventListener('click', (e) => {
            e.stopPropagation();

            const targetNode: NodeItem = {
              id: item.entity.id,
              name: item.entity.name,
              kind: item.entity.kind,
              language: item.entity.language,
              filePath: item.entity.filePath,
              line: item.entity.location.startLine,
              archLayer: item.entity.archLayer,
              archConfidence: item.entity.archConfidence,
              metrics: item.entity.metrics,
              column: this.determineColumn(item.entity),
              row: 0
            };
            this.selectNode(targetNode);

            vscode.postMessage({
              command: 'navigateToFile',
              filePath: item.entity.filePath,
              line: item.entity.location.startLine
            });
          });

          indirectListEl.appendChild(card);
        });
      }
    }
  }

  private applyImpactGraphHighlight(impact: any) {
    if (!impact) return;

    const directIds = new Set(impact.directImpact.map((item: any) => item.entity.id));
    const indirectIds = new Set(impact.indirectImpact.map((item: any) => item.entity.id));
    const targetId = impact.targetEntity.id;

    this.containerGroup.selectAll<SVGGElement, NodeItem>('.node-card').each(function(d) {
      const card = d3.select(this);
      const pill = card.select('.pill-rect');

      if (d.id === targetId) {
        card.attr('opacity', 1);
        pill.attr('stroke', '#00bcff').attr('stroke-width', 4);
      } else if (directIds.has(d.id)) {
        card.attr('opacity', 1);
        pill.attr('stroke', '#e74c3c').attr('stroke-width', 3);
      } else if (indirectIds.has(d.id)) {
        card.attr('opacity', 1);
        pill.attr('stroke', '#e67e22').attr('stroke-width', 2.5);
      } else {
        card.attr('opacity', 0.15);
        pill.attr('stroke', 'rgba(255, 255, 255, 0.15)').attr('stroke-width', 1);
      }
    });
  }

  private applySearchHighlight() {
    if (!this.searchTerm) {
      this.containerGroup.selectAll('.node-card').attr('opacity', 1);
      return;
    }

    this.containerGroup.selectAll<SVGGElement, NodeItem>('.node-card')
      .attr('opacity', d => (d.name.toLowerCase().includes(this.searchTerm) ? 1 : 0.2));
  }

  private highlightFile(filePath: string) {
    const nodes = (this.rawGraphData ? Object.values(this.rawGraphData.entities) : []) as any[];
    const node = nodes.find(n => n.filePath === filePath);
    if (node) {
      this.selectNode(node);
    }
  }

  private updateStats(stats: any) {
    document.getElementById('statFiles')!.innerText = `Files: ${stats.totalFiles}`;
    document.getElementById('statEntities')!.innerText = `Entities: ${stats.totalEntities}`;
    document.getElementById('statLines')!.innerText = `Lines: ${stats.totalLines}`;
    document.getElementById('statLangs')!.innerText = `Languages: ${Object.keys(stats.languages).length}`;
  }

  private checkCycleWarnings(cycles: any[]) {
    const banner = document.getElementById('cycleWarningBanner');
    if (!banner) return;

    if (cycles && cycles.length > 0) {
      document.getElementById('cycleInfo')!.innerText = `${cycles.length} circular dependency cycle(s) detected.`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  private renderTimeMachineCommits(commits: any[]) {
    const fromSelect = document.getElementById('selectFromCommit') as HTMLSelectElement;
    const toSelect = document.getElementById('selectToCommit') as HTMLSelectElement;
    const timelineContainer = document.getElementById('commitTimelineContainer');

    if (fromSelect && toSelect) {
      const fromVal = fromSelect.value;
      const toVal = toSelect.value;

      fromSelect.innerHTML = '';
      toSelect.innerHTML = '';

      commits.forEach(c => {
        const optFrom = document.createElement('option');
        optFrom.value = c.hash;
        optFrom.textContent = `${c.shortHash} - ${c.message} (${c.relativeDate})`;
        fromSelect.appendChild(optFrom);

        const optTo = document.createElement('option');
        optTo.value = c.hash;
        optTo.textContent = `${c.shortHash} - ${c.message} (${c.relativeDate})`;
        toSelect.appendChild(optTo);
      });

      if (fromVal && commits.some(c => c.hash === fromVal)) fromSelect.value = fromVal;
      else if (commits.length > 1) fromSelect.value = commits[1].hash;

      if (toVal && commits.some(c => c.hash === toVal)) toSelect.value = toVal;
      else if (commits.length > 0) toSelect.value = commits[0].hash;
    }

    if (timelineContainer) {
      timelineContainer.innerHTML = '';
      if (commits.length === 0) {
        timelineContainer.innerHTML = `<div class="quad-empty">No Git commits found in workspace.</div>`;
        return;
      }

      commits.forEach(c => {
        const card = document.createElement('div');
        card.className = 'tm-commit-card';
        card.innerHTML = `
          <div class="tm-card-hash">${c.shortHash}</div>
          <div class="tm-card-msg" title="${c.message}">${c.message}</div>
          <div class="tm-card-meta">
            <span>${c.author}</span>
            <span>${c.relativeDate}</span>
          </div>
        `;

        card.addEventListener('click', () => {
          if (fromSelect) fromSelect.value = c.hash;
          document.querySelectorAll('.tm-commit-card').forEach(el => el.classList.remove('active-from'));
          card.classList.add('active-from');
        });

        timelineContainer.appendChild(card);
      });
    }
  }

  private renderComparisonResults(comparison: any) {
    if (!comparison) return;

    const fromTag = document.getElementById('tmFromTag');
    const toTag = document.getElementById('tmToTag');
    if (fromTag) fromTag.innerText = comparison.fromShortHash || 'FROM';
    if (toTag) toTag.innerText = comparison.toShortHash || 'TO';

    // Populate Metrics Table
    const tbody = document.getElementById('metricsCompareTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      (comparison.metricChanges || []).forEach((m: any) => {
        const tr = document.createElement('tr');
        const diffSign = m.diff > 0 ? `+${m.diff}` : `${m.diff}`;
        const badgeClass = m.status === 'improved' ? 'improved' : (m.status === 'regressed' ? 'regressed' : 'unchanged');

        tr.innerHTML = `
          <td><strong>${m.metricName}</strong></td>
          <td>${m.before} ${m.unit || ''}</td>
          <td>${m.after} ${m.unit || ''}</td>
          <td><span class="diff-badge ${badgeClass}">${diffSign} ${m.unit || ''}</span></td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Populate Improvements
    const impList = document.getElementById('tmImprovementsList');
    if (impList) {
      impList.innerHTML = '';
      const imps = comparison.improvements || [];
      if (imps.length === 0) {
        impList.innerHTML = `<div class="quad-empty">No positive structural improvements detected.</div>`;
      } else {
        imps.forEach((imp: string) => {
          const item = document.createElement('div');
          item.className = 'quad-item';
          item.innerHTML = `<span class="quad-code-pill" style="max-width: 100%;">✓ ${imp}</span>`;
          impList.appendChild(item);
        });
      }
    }

    // Populate Regressions
    const regList = document.getElementById('tmRegressionsList');
    if (regList) {
      regList.innerHTML = '';
      const regs = comparison.regressions || [];
      if (regs.length === 0) {
        regList.innerHTML = `<div class="quad-empty">No architecture regressions detected.</div>`;
      } else {
        regs.forEach((reg: string) => {
          const item = document.createElement('div');
          item.className = 'quad-item';
          item.innerHTML = `<span class="quad-code-pill" style="max-width: 100%; color: #ff4d4f;">⚠️ ${reg}</span>`;
          regList.appendChild(item);
        });
      }
    }

    // Populate Evolution Events
    const eventsGrid = document.getElementById('tmEventsGrid');
    if (eventsGrid) {
      eventsGrid.innerHTML = '';
      const events = comparison.architectureEvents || [];
      if (events.length === 0) {
        eventsGrid.innerHTML = `<div class="quad-empty">Clean structural progression without major event triggers.</div>`;
      } else {
        events.forEach((evt: any) => {
          const card = document.createElement('div');
          card.className = 'comp-card';
          card.style.height = 'auto';
          card.innerHTML = `
            <div class="comp-card-label">${evt.title}</div>
            <div style="font-size: 12px; color: #e2e8f0; margin-top: 4px;">${evt.description}</div>
          `;
          eventsGrid.appendChild(card);
        });
      }
    }

    // Apply Change Highlighting to Graph for Diff Visualization
    if (comparison.toSnapshot && comparison.toSnapshot.graphData) {
      const diffGraph = JSON.parse(JSON.stringify(comparison.toSnapshot.graphData)) as GraphData;

      const addedIds = new Set((comparison.addedNodes || []).map((n: any) => n.id));
      const removedIds = new Set((comparison.removedNodes || []).map((n: any) => n.id));
      const modifiedIds = new Set((comparison.modifiedNodes || []).map((m: any) => m.entity.id));

      Object.values(diffGraph.entities).forEach((e: any) => {
        if (addedIds.has(e.id)) e.diffStatus = 'added';
        else if (removedIds.has(e.id)) e.diffStatus = 'removed';
        else if (modifiedIds.has(e.id)) e.diffStatus = 'modified';
        else e.diffStatus = 'unchanged';
      });

      this.rawGraphData = diffGraph;
      this.render();
    }
  }

  private renderExplainChangeResult(explanation: any) {
    const body = document.getElementById('tmExplanationBody');
    if (!body || !explanation) return;
    body.innerHTML = this.buildExplanationHtml(explanation);
  }

  public inspectCycle(cycleIndex: number = 0) {
    if (!this.rawGraphData || !this.rawGraphData.stats.circularDependencies) return;
    const cycles = this.rawGraphData.stats.circularDependencies;
    if (cycles.length === 0) return;

    const targetCycle = cycles[cycleIndex] || cycles[0];
    const cycleNodeIds = new Set<string>(targetCycle.cycleNodes);

    // 1. Ensure visual graph tab is active
    this.switchTab('graph');

    // 2. Select first entity in the cycle to populate Inspector Sidebar
    const firstNodeId = targetCycle.cycleNodes[0];
    const firstEntity = this.rawGraphData.entities[firstNodeId];
    if (firstEntity) {
      this.selectNode(firstEntity as any);
    }

    // 3. Highlight cycle nodes with red alert border
    this.containerGroup.selectAll<SVGGElement, NodeItem>('.node-card').each(function(d) {
      const card = d3.select(this);
      const pill = card.select('.pill-rect');

      if (cycleNodeIds.has(d.id)) {
        card.attr('opacity', 1);
        pill.attr('stroke', '#ff4d4f').attr('stroke-width', 4);
      } else {
        card.attr('opacity', 0.15);
        pill.attr('stroke', 'rgba(255, 255, 255, 0.15)').attr('stroke-width', 1);
      }
    });

    // 4. Highlight cycle edges in solid red
    this.containerGroup.selectAll<SVGPathElement, any>('.graph-edge').each(function(l) {
      const sId = typeof l.source === 'string' ? l.source : l.source?.id;
      const tId = typeof l.target === 'string' ? l.target : l.target?.id;

      const path = d3.select(this);
      if (cycleNodeIds.has(sId) && cycleNodeIds.has(tId)) {
        path.attr('stroke', '#ff4d4f').attr('stroke-width', 3).attr('stroke-dasharray', 'none');
      } else {
        path.attr('stroke', 'rgba(255, 255, 255, 0.15)').attr('stroke-width', 1);
      }
    });

    // 5. Auto-fit canvas zoom focused on the cycle nodes
    const cycleNodesData = this.containerGroup.selectAll<SVGGElement, NodeItem>('.node-card')
      .data()
      .filter(n => cycleNodeIds.has(n.id));

    if (cycleNodesData.length > 0) {
      const xs = cycleNodesData.map(n => n.x || 0);
      const ys = cycleNodesData.map(n => n.y || 0);
      const minX = Math.min(...xs) - 150;
      const maxX = Math.max(...xs) + 150;
      const minY = Math.min(...ys) - 100;
      const maxY = Math.max(...ys) + 100;
      const width = maxX - minX;
      const height = maxY - minY;
      const svgWidth = window.innerWidth || 1000;
      const svgHeight = window.innerHeight || 800;
      const scale = Math.min(1.2, Math.max(0.3, Math.min(svgWidth / width, svgHeight / height)));
      const tx = (svgWidth - scale * (minX + maxX)) / 2;
      const ty = (svgHeight - scale * (minY + maxY)) / 2;

      this.svg.transition().duration(600).call(
        this.zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    }
  }

  private autoFitToContent() {
    const nodes = this.containerGroup.selectAll<SVGGElement, NodeItem>('.node-card').data();
    if (nodes.length === 0) return;

    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);

    const minX = Math.min(...xs) - 150;
    const maxX = Math.max(...xs) + 150;
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 100;

    const width = maxX - minX;
    const height = maxY - minY;

    const svgWidth = window.innerWidth || 1000;
    const svgHeight = window.innerHeight || 800;

    const scale = Math.min(1.2, Math.max(0.2, Math.min(svgWidth / width, svgHeight / height)));
    const tx = (svgWidth - scale * (minX + maxX)) / 2;
    const ty = (svgHeight - scale * (minY + maxY)) / 2;

    this.svg.transition().duration(600).call(
      this.zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }
}

new CodePrismApp();
