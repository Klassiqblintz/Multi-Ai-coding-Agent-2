import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../agent/agent_client.dart';
import '../agent/agent_controller.dart';
import '../agent/models.dart';
import 'kit.dart';
import 'theme.dart';

/// "Custom provider" entry: any OpenAI-compatible endpoint, which also covers
/// local inference servers (Ollama, LM Studio, llama.cpp, vLLM).
class CustomProviderSection extends StatelessWidget {
  const CustomProviderSection({super.key, required this.agent});
  final AgentController agent;

  @override
  Widget build(BuildContext context) => _CustomProviderSection(agent: agent);
}

class _CustomProviderSection extends StatefulWidget {
  const _CustomProviderSection({required this.agent});
  final AgentController agent;

  @override
  State<_CustomProviderSection> createState() => _CustomProviderSectionState();
}

class _CustomProviderSectionState extends State<_CustomProviderSection> {
  List<CustomProvider> custom = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await widget.agent.customProviders();
      if (mounted) setState(() => custom = list);
    } on AgentError {
      // The list is a convenience; an agent that is still starting just shows none.
    }
  }

  Future<void> _add() async {
    final result = await showCustomProviderSheet(context, widget.agent);
    if (result == true) {
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Provider added. Pulling its model list now.')));
      }
    }
  }

  Future<void> _remove(CustomProvider provider) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${provider.name}?'),
        content: Text('The endpoint and its key are deleted from this device. Models from it disappear.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: context.palette.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.agent.removeProvider(provider.id);
      await _load();
    } on AgentError catch (e) {
      if (mounted) _toast(context, e.message);
    }
  }

  void _toast(BuildContext context, String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader('Your endpoints'),
        for (final c in custom)
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
            leading: c.local
                ? Icon(LucideIcons.server, size: 20, color: p.muted)
                : BrandTile(id: c.id, size: 38),
            title: Text(c.name, style: text.titleSmall),
            subtitle: Text(c.baseUrl, maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: IconButton(
              icon: Icon(LucideIcons.trash2, size: 18, color: p.muted),
              onPressed: () => _remove(c),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: OutlinedButton.icon(
            onPressed: _add,
            icon: const Icon(LucideIcons.plus, size: 18),
            label: const Text('Add custom provider'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
          child: Text(
            'Any OpenAI-compatible endpoint. Local servers work too — leave the key empty for Ollama or LM Studio.',
            style: text.bodySmall,
          ),
        ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
    child: Text(label.toUpperCase(), style: Theme.of(context).textTheme.labelSmall),
  );
}

/// Form for a user-defined provider. The key is optional because local
/// inference servers do not check it.
Future<bool?> showCustomProviderSheet(BuildContext context, AgentController agent) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _CustomProviderForm(agent: agent),
  );
}

class _CustomProviderForm extends StatefulWidget {
  const _CustomProviderForm({required this.agent});
  final AgentController agent;

  @override
  State<_CustomProviderForm> createState() => _CustomProviderFormState();
}

class _CustomProviderFormState extends State<_CustomProviderForm> {
  final name = TextEditingController();
  final url = TextEditingController();
  final key = TextEditingController();
  bool obscure = true;
  bool saving = false;
  String? error;

  @override
  void dispose() {
    name.dispose();
    url.dispose();
    key.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final endpoint = url.text.trim();
    if (endpoint.isEmpty) {
      setState(() => error = 'Enter the endpoint URL.');
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.agent.addProvider(
        name: name.text.trim().isEmpty ? _hostOf(endpoint) : name.text.trim(),
        baseUrl: endpoint,
        apiKey: key.text.trim(),
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on AgentError catch (e) {
      if (mounted) {
        setState(() {
          saving = false;
          error = e.message;
        });
      }
    }
  }

  /// Falls back to the endpoint host when no name was typed.
  String _hostOf(String url) {
    final uri = Uri.tryParse(url);
    return (uri?.host.isNotEmpty ?? false) ? uri!.host : url;
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.72,
        maxChildSize: 0.95,
        builder: (context, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
          children: [
            Text('Custom provider', style: text.titleLarge),
            const SizedBox(height: 4),
            Text('Point the app at any OpenAI-compatible API, or a model server on this device or your network.', style: text.bodySmall),
            const SizedBox(height: 20),
            TextField(
              controller: name,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Name', hintText: 'My server'),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: url,
              keyboardType: TextInputType.url,
              autocorrect: false,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Endpoint URL',
                hintText: 'https://api.example.com/v1  ·  http://192.168.1.10:11434/v1',
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: key,
              obscureText: obscure,
              autocorrect: false,
              decoration: InputDecoration(
                labelText: 'API key (optional)',
                hintText: 'Leave empty for local servers',
                suffixIcon: IconButton(
                  icon: Icon(obscure ? LucideIcons.eye : LucideIcons.eyeOff, size: 18),
                  onPressed: () => setState(() => obscure = !obscure),
                ),
              ),
            ),
            if (error != null) ...[
              const SizedBox(height: 14),
              Text(error!, style: text.bodySmall?.copyWith(color: context.palette.danger)),
            ],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: saving ? null : _save,
              child: saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Add provider'),
            ),
          ],
        ),
      ),
    );
  }
}