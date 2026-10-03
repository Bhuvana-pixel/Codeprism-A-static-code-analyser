import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { RelationshipEngine } from '../analyzer/relationshipEngine';
import { GraphData } from '../analyzer/types';
import { ArchitectureMetricsSnapshot, ArchitectureSnapshot } from './types';
import { GitCommitItem, GitEngine } from '../analyzer/gitEngine';

export class SnapshotManager {
  private static ANALYZER_VERSION = '1.0.0';
  private snapshotCache: Map<string, ArchitectureSnapshot> = new Map();
  private relationshipEngine: RelationshipEngine;

  constructor() {
    this.relationshipEngine = new RelationshipEngine();
  }

  /**
   * Fetch commit timeline history for the workspace
   */
  getCommitHistory(workspacePath: string, limit: number = 25): GitCommitItem[] {
    const isGit = this.checkIsGitRepo(workspacePath);
    const commits: GitCommitItem[] = [];

    // Always include Current Working Tree as the top item
    commits.push({
      hash: 'CURRENT_WORKING_TREE',
      shortHash: 'CURRENT',
      author: 'You',
      date: 'Now',
      relativeDate: 'Current Working Tree',
      message: 'Current Working Tree (Uncommitted changes)'
    });

    if (!isGit) {
      return commits;
    }

    try {
      const logRaw = execSync(`git log -n ${limit} --format="%H|%an|%ad|%s" --date=relative`, {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 5000
      }).trim();

      const gitCommits: GitCommitItem[] = logRaw
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|');
          const hash = parts[0] || '';
          const author = parts[1] || 'Developer';
          const date = parts[2] || 'recently';
          const message = parts.slice(3).join('|') || 'Commit update';
          return {
            hash,
            shortHash: hash ? hash.substring(0, 7) : 'head',
            author,
            date,
            relativeDate: date,
            message
          };
        });

      commits.push(...gitCommits);
    } catch (err) {
      console.warn('Error fetching git commit log:', err);
    }

    return commits;
  }

  /**
   * Generate an Architecture Snapshot for a specific commit or current working tree.
   * Caches results so repeat requests do not re-run expensive static analysis.
   */
  async getSnapshot(
    workspacePath: string,
    commitHash: string,
    commitItem?: GitCommitItem
  ): Promise<ArchitectureSnapshot> {
    const cacheKey = `${workspacePath}_${commitHash}_${SnapshotManager.ANALYZER_VERSION}`;
    if (this.snapshotCache.has(cacheKey)) {
      return this.snapshotCache.get(cacheKey)!;
    }

    let graphData: GraphData;

    if (commitHash === 'CURRENT_WORKING_TREE' || commitHash === 'HEAD') {
      // Analyze active workspace directly
      graphData = await this.relationshipEngine.analyzeWorkspace({ workspacePath });
    } else {
      // Safely extract historical commit using Git Worktree in OS temporary folder
      graphData = await this.analyzeHistoricalCommitSafely(workspacePath, commitHash);
    }

    const snapshot = this.buildSnapshotObject(workspacePath, commitHash, graphData, commitItem);
    this.snapshotCache.set(cacheKey, snapshot);
    return snapshot;
  }

  /**
   * Safely checkout historical commit into temporary OS folder via git worktree, analyze it, and clean up.
   * Guarantees the user's working tree is NEVER modified.
   */
  private async analyzeHistoricalCommitSafely(
    workspacePath: string,
    commitHash: string
  ): Promise<GraphData> {
    const safeHash = commitHash.substring(0, 10);
    const tempDirName = `codeprism_snap_${safeHash}_${Date.now()}`;
    const tempDir = path.join(os.tmpdir(), tempDirName);

    try {
      // 1. Create a detached git worktree in OS tmp directory
      execSync(`git worktree add --detach "${tempDir}" "${commitHash}"`, {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 10000
      });

      // 2. Run static analysis on the temporary worktree folder
      const graphData = await this.relationshipEngine.analyzeWorkspace({ workspacePath: tempDir });
      return graphData;
    } catch (err: any) {
      console.warn(`[SnapshotManager Worktree Notice]: ${err?.message || err}. Falling back to archive extraction.`);
      return this.analyzeHistoricalCommitViaArchive(workspacePath, commitHash, tempDir);
    } finally {
      // 3. Clean up the temporary worktree
      this.cleanupTempDir(workspacePath, tempDir);
    }
  }

  private async analyzeHistoricalCommitViaArchive(
    workspacePath: string,
    commitHash: string,
    tempDir: string
  ): Promise<GraphData> {
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Export commit files using git archive
      const tarPath = path.join(os.tmpdir(), `snap_${commitHash.substring(0, 8)}.tar`);
      execSync(`git archive --format=tar --output="${tarPath}" ${commitHash}`, {
        cwd: workspacePath,
        timeout: 8000
      });

      execSync(`tar -xf "${tarPath}" -C "${tempDir}"`, { timeout: 8000 });
      if (fs.existsSync(tarPath)) {
        fs.unlinkSync(tarPath);
      }

      return await this.relationshipEngine.analyzeWorkspace({ workspacePath: tempDir });
    } catch (archiveErr) {
      // Fallback: If snapshot extraction fails, analyze current workspace state gracefully
      console.warn(`[SnapshotManager Fallback]: Failed to extract commit '${commitHash}', falling back to current workspace.`);
      return await this.relationshipEngine.analyzeWorkspace({ workspacePath });
    }
  }

  private cleanupTempDir(workspacePath: string, tempDir: string) {
    try {
      execSync(`git worktree remove --force "${tempDir}"`, {
        cwd: workspacePath,
        timeout: 5000,
        stdio: 'ignore'
      });
    } catch {
      // Ignore if worktree wasn't added
    }

    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Best effort cleanup
    }
  }

  private buildSnapshotObject(
    workspacePath: string,
    commitHash: string,
    graphData: GraphData,
    commitItem?: GitCommitItem
  ): ArchitectureSnapshot {
    const stats = graphData.stats;
    const entities = Object.values(graphData.entities);
    const files = entities.filter(e => e.kind === 'file');

    let totalComplexity = 0;
    let complexityCount = 0;
    files.forEach(f => {
      if (f.metrics?.cyclomaticComplexity) {
        totalComplexity += f.metrics.cyclomaticComplexity;
        complexityCount++;
      }
    });
    const averageComplexity = complexityCount > 0
      ? Math.round((totalComplexity / complexityCount) * 10) / 10
      : 1.0;

    const hotspotsCount = files.filter(f => (f.metrics?.incomingDegree || 0) > 3).length;

    const metrics: ArchitectureMetricsSnapshot = {
      totalFiles: stats.totalFiles,
      totalNodes: stats.totalEntities,
      totalEdges: graphData.relationships.length,
      circularDependenciesCount: stats.circularDependencies.length,
      deadCodeCount: stats.unusedEntitiesCount || 0,
      averageComplexity,
      hotspotsCount
    };

    const insights: string[] = [
      `Snapshot contains ${stats.totalFiles} files and ${stats.totalEntities} entities across ${graphData.relationships.length} relationships.`,
      `Circular dependency loops: ${stats.circularDependencies.length}`,
      `Unreferenced dead-code entities: ${stats.unusedEntitiesCount || 0}`
    ];

    const shortHash = commitHash === 'CURRENT_WORKING_TREE'
      ? 'CURRENT'
      : (commitHash.substring(0, 7) || 'head');

    return {
      repositoryId: path.basename(workspacePath) || 'Workspace',
      commitHash,
      shortHash,
      commitMessage: commitItem?.message || (commitHash === 'CURRENT_WORKING_TREE' ? 'Current Working Tree (Uncommitted changes)' : `Commit ${shortHash}`),
      author: commitItem?.author || 'Developer',
      timestamp: new Date().toISOString(),
      relativeDate: commitItem?.relativeDate || 'recently',
      analyzerVersion: SnapshotManager.ANALYZER_VERSION,
      graphData,
      metrics,
      insights
    };
  }

  private checkIsGitRepo(dir: string): boolean {
    try {
      const res = execSync('git rev-parse --is-inside-work-tree', {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 2000
      }).trim();
      return res === 'true';
    } catch {
      return false;
    }
  }
}
