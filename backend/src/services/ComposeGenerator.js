'use strict';

/**
 * ComposeGenerator — converte uma Stack em docker-compose.yml válido.
 *
 * O arquivo gerado é compatível com docker-compose v3.8 e pode ser usado
 * diretamente com `docker compose up -d` em qualquer máquina.
 *
 * Serve como "exportação portável" da infra criada no painel.
 */

class ComposeGenerator {
  /**
   * Gera o conteúdo do docker-compose.yml a partir de uma Stack.
   * @param {Object} stack - Objeto Stack do StackManager
   * @returns {string} - Conteúdo YAML do compose
   */
  generate(stack) {
    const lines = [];

    lines.push('# docker-compose.yml gerado pelo ProvirPanel - Infrastructure Canvas');
    lines.push(`# Stack: ${stack.name}`);
    lines.push(`# Cliente: ${stack.client || 'N/A'}`);
    lines.push(`# Ambiente: ${stack.environment}`);
    lines.push(`# Gerado em: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('version: "3.8"');
    lines.push('');
    lines.push('services:');

    for (const svc of stack.services) {
      const imageFull = `${svc.image}:${svc.tag || 'latest'}`;

      lines.push(`  ${svc.name}:`);
      lines.push(`    image: ${imageFull}`);

      // Labels de rastreabilidade
      lines.push('    labels:');
      lines.push('      - "provirpanel.managed=true"');
      lines.push(`      - "provirpanel.stack.id=${stack.id}"`);
      lines.push(`      - "provirpanel.service.id=${svc.id}"`);
      lines.push(`      - "provirpanel.service.role=${svc.role || 'runtime'}"`);

      // Comando personalizado
      if (svc.command?.length) {
        const cmd = svc.command.map((c) => JSON.stringify(c)).join(', ');
        lines.push(`    command: [${cmd}]`);
      }

      // Portas
      if (svc.ports?.length) {
        lines.push('    ports:');
        for (const p of svc.ports) {
          lines.push(`      - "${p.host}:${p.container}"`);
        }
      }

      // Volumes
      if (svc.volumes?.length) {
        lines.push('    volumes:');
        for (const v of svc.volumes) {
          // Volumes nomeados vs bind mounts
          if (v.host.startsWith('/') || v.host.startsWith('./') || v.host.startsWith('../')) {
            lines.push(`      - ${v.host}:${v.container}`);
          } else {
            // Volume nomeado
            lines.push(`      - ${v.host}:${v.container}`);
          }
        }
      }

      // Variáveis de ambiente
      if (svc.env?.length) {
        lines.push('    environment:');
        for (const e of svc.env) {
          // Secrets são mascarados no YAML comentado para segurança
          if (e.secret) {
            lines.push(`      ${e.key}: "\${${e.key}}"  # Secret - use .env file`);
          } else {
            const val = String(e.value || '');
            const needsQuotes = val.includes(':') || val.includes('#') || val === '' || val.includes('$');
            lines.push(`      ${e.key}: ${needsQuotes ? `"${val.replace(/"/g, '\\"')}"` : val}`);
          }
        }
      }

      // Dependências
      const depNames = (svc.dependencies || [])
        .map((depId) => stack.services.find((s) => s.id === depId)?.name)
        .filter(Boolean);

      if (depNames.length) {
        lines.push('    depends_on:');
        for (const dep of depNames) {
          lines.push(`      ${dep}:`);
          lines.push('        condition: service_started');
        }
      }

      const replicas = Number(svc.scaling?.replicas || 1);
      const cpuLimit = Number(svc.resources?.cpuLimit || 0);
      const memoryMb = Number(svc.resources?.memoryMb || 0);
      if (replicas > 1 || cpuLimit > 0 || memoryMb > 0) {
        lines.push('    deploy:');
        if (replicas > 1) {
          lines.push(`      replicas: ${replicas}`);
        }
        if (cpuLimit > 0 || memoryMb > 0) {
          lines.push('      resources:');
          lines.push('        limits:');
          if (cpuLimit > 0) {
            lines.push(`          cpus: "${cpuLimit}"`);
          }
          if (memoryMb > 0) {
            lines.push(`          memory: "${memoryMb}M"`);
          }
        }
      }

      // Rede
      lines.push('    networks:');
      lines.push(`      - ${stack.network}`);

      // Restart policy
      lines.push('    restart: unless-stopped');
      lines.push('');
    }

    // Rede da stack
    lines.push('networks:');
    lines.push(`  ${stack.network}:`);
    lines.push('    driver: bridge');
    lines.push(`    name: ${stack.network}`);

    // Volumes nomeados (deduplica)
    const namedVolumes = new Set();
    for (const svc of stack.services) {
      for (const v of (svc.volumes || [])) {
        if (!v.host.startsWith('/') && !v.host.startsWith('./') && !v.host.startsWith('../')) {
          namedVolumes.add(v.host);
        }
      }
    }

    if (namedVolumes.size) {
      lines.push('');
      lines.push('volumes:');
      for (const vol of namedVolumes) {
        lines.push(`  ${vol}:`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Gera um arquivo .env de exemplo com todas as variáveis de ambiente.
   * Secrets ficam com valor em branco para preenchimento manual.
   */
  generateEnvFile(stack) {
    const lines = [];
    lines.push(`# .env — Stack: ${stack.name}`);
    lines.push(`# Ambiente: ${stack.environment}`);
    lines.push(`# Gerado em: ${new Date().toISOString()}`);
    lines.push('# Preencha os valores antes de usar docker compose up');
    lines.push('');

    for (const svc of stack.services) {
      if (!svc.env?.length) continue;
      lines.push(`# === ${svc.name} (${svc.role || 'runtime'}) ===`);
      for (const e of svc.env) {
        if (e.secret) {
          lines.push(`${e.key}=`);
        } else {
          lines.push(`${e.key}=${e.value || ''}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Valida uma stack antes de gerar o compose.
   * Retorna lista de erros/avisos.
   */
  validate(stack) {
    const errors = [];
    const warnings = [];

    if (!stack.services?.length) {
      errors.push('Stack não tem serviços configurados');
    }

    const names = new Set();
    for (const svc of (stack.services || [])) {
      if (!svc.name) errors.push(`Serviço sem nome (id: ${svc.id})`);
      if (!svc.image) errors.push(`Serviço "${svc.name}" sem imagem definida`);
      if (names.has(svc.name)) errors.push(`Nome duplicado: "${svc.name}"`);
      names.add(svc.name);

      // Avisos de boas práticas
      if (svc.role === 'database' && !svc.volumes?.length) {
        warnings.push(`Banco de dados "${svc.name}" sem volume persistente — dados serão perdidos ao reiniciar`);
      }
      if (svc.role === 'entry-point' && !svc.ports?.length) {
        warnings.push(`Serviço de entrada "${svc.name}" sem portas expostas`);
      }
      if (svc.role === 'runtime' && !svc.dependencies?.length) {
        warnings.push(`Runtime "${svc.name}" sem dependências declaradas — verifique se precisa de banco ou cache`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

module.exports = ComposeGenerator;
