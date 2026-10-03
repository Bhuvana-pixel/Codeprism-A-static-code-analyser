import * as path from 'path';
import { RelationshipEngine } from '../src/analyzer/relationshipEngine';
import { IntelligenceEngine } from '../src/analyzer/intelligenceEngine';
import { ContextBuilder } from '../src/explanation/contextBuilder';
import { CodePrismExplanationService } from '../src/explanation/explanationService';
import { EXPLANATION_SYSTEM_PROMPT } from '../src/explanation/types';

async function runTests() {
  console.log('=== CodePrism Multi-Language & LLM Explanation Test Suite ===\n');

  const demoPath = path.resolve(__dirname, '..', 'demo-workspace');
  console.log(`[Test 1] Analyzing Workspace at ${demoPath}...`);

  const engine = new RelationshipEngine();
  const graphData = await engine.analyzeWorkspace({ workspacePath: demoPath });

  console.log(`✓ Total Files Analyzed: ${graphData.stats.totalFiles}`);
  console.log(`✓ Total Entities Extracted: ${graphData.stats.totalEntities}`);
  console.log(`✓ Total Lines of Code: ${graphData.stats.totalLines}`);
  console.log(`✓ Languages Detected:`, graphData.stats.languages);
  console.log(`✓ Architectural Layers:`, graphData.stats.layerCounts);

  // Assert basic language counts
  const langs = Object.keys(graphData.stats.languages);
  if (langs.length < 5) {
    throw new Error(`Expected at least 5 languages detected, got ${langs.length}`);
  }
  console.log('✓ Multi-Language Detection Passed!');

  // Test Circular Dependency Detection
  console.log('\n[Test 2] Testing Circular Dependency Detector...');
  console.log(`✓ Circular Cycles Detected: ${graphData.stats.circularDependencies.length}`);
  graphData.stats.circularDependencies.forEach(cycle => {
    console.log(`  - Cycle (${cycle.id}): ${cycle.cycleFiles.join(' -> ')}`);
  });

  // Test Impact Analysis
  console.log('\n[Test 3] Testing Transitive Impact Analysis...');
  const firstEntityId = Object.keys(graphData.entities)[0];
  if (firstEntityId) {
    const impact = IntelligenceEngine.analyzeImpact(firstEntityId, graphData.entities, graphData.relationships);
    console.log(`✓ Target Entity: ${graphData.entities[firstEntityId].name}`);
    console.log(`✓ Direct Dependents Count: ${impact.directImpact.length}`);
    console.log(`✓ Transitive Impact Range Count: ${impact.allAffectedEntityIds.length}`);
  }

  // Test LLM Context Builder (Node & Module Context Extraction)
  console.log('\n[Test 4] Testing ContextBuilder (Static Analysis Context Generation)...');
  const nodeContext = ContextBuilder.buildNodeContext(firstEntityId, graphData, 'DemoWorkspace');
  if (!nodeContext) {
    throw new Error('Failed to build node context from static analysis graph data.');
  }

  if (!nodeContext.node || !nodeContext.staticAnalysis || !nodeContext.staticAnalysis.metrics) {
    throw new Error('Node context missing required static analysis fields.');
  }
  console.log(`✓ Node Context Built for '${nodeContext.node.name}' (${nodeContext.node.type}, layer: ${nodeContext.node.layer})`);
  console.log(`✓ Static Analysis Metrics: LOC=${nodeContext.staticAnalysis.metrics.linesOfCode}, Dependencies=${nodeContext.staticAnalysis.metrics.dependencyCount}`);

  const moduleContext = ContextBuilder.buildModuleContext('service', graphData, 'DemoWorkspace');
  if (!moduleContext || !moduleContext.module || !moduleContext.staticAnalysis) {
    throw new Error('Failed to build module context from static analysis.');
  }
  console.log(`✓ Module Context Built for '${moduleContext.module.name}' (Files=${moduleContext.module.filesCount})`);

  // Test LLM Explanation Service
  console.log('\n[Test 5] Testing CodePrismExplanationService (Explanation Generation & Fallbacks)...');
  const explanationService = new CodePrismExplanationService();

  const nodeExplanation = await explanationService.explainNode(nodeContext);
  if (!nodeExplanation.title || !nodeExplanation.summary || !Array.isArray(nodeExplanation.sections)) {
    throw new Error('Node explanation response schema invalid.');
  }
  console.log(`✓ Node Explanation Title: "${nodeExplanation.title}"`);
  console.log(`✓ Sections Count: ${nodeExplanation.sections.length}`);
  console.log(`✓ Limitations Included:`, nodeExplanation.limitations);

  const moduleExplanation = await explanationService.explainModule(moduleContext);
  if (!moduleExplanation.title || !moduleExplanation.summary || !Array.isArray(moduleExplanation.sections)) {
    throw new Error('Module explanation response schema invalid.');
  }
  console.log(`✓ Module Explanation Title: "${moduleExplanation.title}"`);

  // Test System Prompt Constraints
  console.log('\n[Test 6] Testing LLM System Prompt Restrictions...');
  if (!EXPLANATION_SYSTEM_PROMPT.includes('You must NOT perform repository analysis yourself.')) {
    throw new Error('System prompt missing strict static-analysis restriction!');
  }
  if (!EXPLANATION_SYSTEM_PROMPT.includes('If information is missing, explicitly say that the information is not available')) {
    throw new Error('System prompt missing insufficient information clause!');
  }
  console.log('✓ System Prompt Strict Constraints Verified!');

  // Test Architecture Time Machine
  console.log('\n[Test 7] Testing Architecture Time Machine (Snapshot Generation & Structural Comparison)...');
  const { SnapshotManager } = await import('../src/time-machine/snapshotManager');
  const { ArchitectureComparer } = await import('../src/time-machine/comparisonEngine');
  const { TimeMachineExplanationBuilder, TIME_MACHINE_SYSTEM_PROMPT } = await import('../src/time-machine/timeMachineExplanation');

  const snapshotManager = new SnapshotManager();
  const commits = snapshotManager.getCommitHistory(demoPath);
  if (commits.length === 0 || commits[0].hash !== 'CURRENT_WORKING_TREE') {
    throw new Error('Commit timeline history generation failed.');
  }
  console.log(`✓ Commit Timeline Fetched: ${commits.length} item(s)`);

  const currentSnapshot = await snapshotManager.getSnapshot(demoPath, 'CURRENT_WORKING_TREE');
  if (!currentSnapshot || !currentSnapshot.metrics || currentSnapshot.metrics.totalFiles === 0) {
    throw new Error('Current working tree snapshot generation failed.');
  }
  console.log(`✓ Current Snapshot Generated: ${currentSnapshot.metrics.totalFiles} files, ${currentSnapshot.metrics.totalNodes} nodes`);

  // Create a synthetic second snapshot to test comparison diff
  const modifiedGraphData = JSON.parse(JSON.stringify(currentSnapshot.graphData));
  const newEntityId = 'synthetic_payment_service';
  modifiedGraphData.entities[newEntityId] = {
    id: newEntityId,
    name: 'PaymentService',
    kind: 'class',
    language: 'typescript',
    filePath: 'src/services/PaymentService.ts',
    relativePath: 'src/services/PaymentService.ts',
    location: { startLine: 1, endLine: 50 },
    archLayer: 'service',
    archConfidence: 95,
    metrics: { loc: 50, incomingDegree: 1, outgoingDegree: 2, cyclomaticComplexity: 3 }
  };
  modifiedGraphData.stats.totalEntities++;
  modifiedGraphData.stats.totalFiles++;

  const syntheticSnapshot = {
    ...currentSnapshot,
    commitHash: 'synthetic_head',
    shortHash: 'synhead',
    commitMessage: 'Add PaymentService',
    graphData: modifiedGraphData,
    metrics: {
      ...currentSnapshot.metrics,
      totalFiles: currentSnapshot.metrics.totalFiles + 1,
      totalNodes: currentSnapshot.metrics.totalNodes + 1
    }
  };

  const comparison = ArchitectureComparer.compare(currentSnapshot, syntheticSnapshot);
  if (comparison.addedNodes.length !== 1 || comparison.addedNodes[0].name !== 'PaymentService') {
    throw new Error('Comparison engine failed to detect added PaymentService node.');
  }
  console.log(`✓ Structural Comparison Passed: ${comparison.addedNodes.length} added node(s), ${comparison.metricChanges.length} metric comparison(s)`);

  const tmExplanation = TimeMachineExplanationBuilder.generateFallbackExplanation(comparison);
  if (!tmExplanation.title || !tmExplanation.summary) {
    throw new Error('Time Machine LLM change explanation generation failed.');
  }
  console.log(`✓ Time Machine AI Change Explanation Title: "${tmExplanation.title}"`);

  if (!TIME_MACHINE_SYSTEM_PROMPT.includes('You are the CodePrism AI Architecture Change Assistant.')) {
    throw new Error('Time Machine System Prompt missing required header.');
  }
  console.log('✓ Time Machine System Prompt Restrictions Verified!');

  console.log('\n=============================================');
  console.log('🎉 ALL CODEPRISM TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================\n');
}

runTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
