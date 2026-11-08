#!/usr/bin/env python3
"""Hatch VM helper: prepares files, never connects to a service or edits Mac business data."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import uuid

STAGES = ('discovery', 'screening', 'tailoring', 'review', 'apply', 'ledger')

def read(file):
    return json.loads(pathlib.Path(file).read_text())

def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def safe_id(value):
    if not isinstance(value, str) or len(value) > 180 or '..' in value or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', value):
        raise ValueError('Unsafe identity')
    return value

def write(file, value):
    dest = pathlib.Path(file)
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = dest.with_name('.' + dest.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False, indent=2)
        os.replace(temp, dest)
    finally:
        if temp.exists(): temp.unlink()

def envelope(event, payload, task_id=None):
    return {'taskId': safe_id(task_id or 'muse-' + uuid.uuid4().hex), 'event': event, 'createdAt': stamp(), 'payload': payload}

def request(args):
    payload = {'sessionId': safe_id(args.session_id or 'muse-run-' + uuid.uuid4().hex), 'stage': args.stage, 'task': pathlib.Path(args.task_file).read_text()}
    if args.job_id: payload['jobId'] = safe_id(args.job_id)
    if not payload['task'].strip() or len(payload['task']) > 8000: raise ValueError('Task must contain 1 to 8000 characters')
    if pathlib.Path(args.out).exists(): raise ValueError('Request exists; reuse the exact file for a transport retry')
    item = envelope('AGENT_CONTEXT_REQUESTED', payload)
    write(args.out, item)
    return {'taskId': item['taskId'], 'sessionId': payload['sessionId'], 'eventFile': args.out, 'queued': False}

def load(args):
    snapshot, receipt, req = read(args.snapshot), read(args.receipt), read(args.request)
    identity = hashlib.sha256(json.dumps(req, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    if receipt.get('status') not in ('committed', 'verified') or receipt.get('event') != 'AGENT_CONTEXT_REQUESTED' or receipt.get('taskId') != req['taskId'] or snapshot.get('requestTaskId') != req['taskId'] or receipt.get('inputHash') != identity or snapshot.get('inputHash') != identity:
        raise ValueError('Context request/Receipt identity mismatch or not committed')
    if hashlib.sha256(snapshot['content'].encode()).hexdigest() != snapshot['digest']: raise ValueError('Context digest mismatch')
    context = json.loads(snapshot['content'])
    if context['workspace'] != args.workspace or context['stage'] != req['payload']['stage'] or context['task'] != req['payload']['task'] or context.get('job', {}).get('jobId') != req['payload'].get('jobId') or snapshot['sessionId'] != req['payload']['sessionId']:
        raise ValueError('Workspace/task/session mismatch')
    state = {'contextTaskId': req['taskId'], 'digest': snapshot['digest'], 'runId': snapshot['sessionId'], 'activityId': safe_id(args.activity_id or 'activity-' + snapshot['sessionId']), 'sequence': 0, 'stage': context['stage'], 'jobId': context.get('job', {}).get('jobId'), 'knowledgeAvailable': context.get('knowledgeAvailable', False), 'knowledgeVersion': context['knowledgeVersion'], 'knowledgeCount': len(context['knowledge']), 'lastStatus': None}
    if pathlib.Path(args.state).exists():
        old = read(args.state)
        if old['contextTaskId'] != state['contextTaskId'] or old['digest'] != state['digest'] or old['activityId'] != state['activityId']: raise ValueError('Do not replace a previous run state; use a new state file')
    else: write(args.state, state)
    # Full rules are printed only when explicitly requested for the VM-local read.
    return context if args.full else {key: state[key] for key in ('contextTaskId', 'digest', 'runId', 'activityId', 'knowledgeAvailable', 'knowledgeVersion', 'knowledgeCount')}

def report(args):
    state = read(args.state)
    if pathlib.Path(args.out).exists(): raise ValueError('Event exists; retry its exact bytes, never regenerate it')
    if args.scope == 'job' and not state.get('jobId'): raise ValueError('Job scope requires a job-bound context')
    if args.scope == 'batch' and (state.get('jobId') or state['stage'] == 'apply'): raise ValueError('Batch scope cannot replace job-scoped application activity')
    if state['lastStatus'] in ('done', 'failed'): raise ValueError('Terminal attempt; request fresh context and explicitly restart')
    if state['lastStatus'] == 'waiting' and args.status == 'running':
        answer = read(args.resume_answer) if args.resume_answer else {}
        if answer.get('status') != 'answered' or answer.get('sourceActivityId') != state['activityId']: raise ValueError('Read the matching Engine-recorded user answer before resuming')
    if state['sequence'] == 0 and args.status != 'running': raise ValueError('Start with a real running signal')
    if args.restart_of and (state['sequence'] != 0 or args.status != 'running'): raise ValueError('restartOf belongs only to the first running event')
    payload = {'activityId': state['activityId'], 'runId': state['runId'], 'sequence': state['sequence'], 'stage': state['stage'], 'kind': 'applying' if state['stage'] == 'apply' else 'screening' if state['stage'] == 'screening' else 'other', 'title': args.title, 'status': args.status, 'note': args.note or ('Muse 上下文已加载 ' + state['digest'] if state['sequence'] == 0 else ''), 'contextTaskId': state['contextTaskId'], 'contextDigest': state['digest']}
    if state.get('jobId'): payload['jobId'] = state['jobId']
    if args.scope: payload['scope'] = args.scope
    if args.restart_of: payload['restartOf'] = safe_id(args.restart_of)
    item = envelope('AGENT_ACTIVITY', payload, state['runId'] + '-' + str(state['sequence']).zfill(8))
    if args.status == 'done':
        proof = read(args.proof_file) if args.proof_file else {}
        expected = {'discovery': ('DISCOVERED',), 'screening': ('SCREENED',), 'tailoring': ('TAILORED',), 'review': ('USER_DECIDED',), 'apply': ('APPLICATION_SUBMITTED',), 'ledger': ('APPLICATION_SUBMITTED', 'FOLLOWUP_RECEIVED')}
        receipts = proof.get('receipts', [])
        if not receipts or any(r.get('status') not in ('committed', 'verified') or r.get('event') not in expected[state['stage']] for r in receipts): raise ValueError('Provide copied committed business Receipts for this stage')
        payload['refs'] = [safe_id(r['taskId']) for r in receipts]
        item['evidence'] = [{'kind': 'receipt', 'text': 'Engine business Receipts: ' + ', '.join(payload['refs'])}]
    if len(args.title.strip()) == 0 or len(payload['note']) > 300: raise ValueError('Title required; note is at most 300 characters')
    write(args.out, item)
    state['sequence'] += 1
    state['lastStatus'] = args.status
    write(args.state, state)
    return {'taskId': item['taskId'], 'eventFile': args.out, 'queued': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    req = commands.add_parser('request'); req.add_argument('--stage', choices=STAGES, required=True); req.add_argument('--task-file', required=True); req.add_argument('--session-id'); req.add_argument('--job-id'); req.add_argument('--out', required=True)
    context = commands.add_parser('load');
    for name in ('snapshot', 'receipt', 'request', 'state', 'workspace'): context.add_argument('--' + name, required=True)
    context.add_argument('--activity-id'); context.add_argument('--full', action='store_true')
    act = commands.add_parser('report'); act.add_argument('--state', required=True); act.add_argument('--status', choices=('running', 'waiting', 'failed', 'done'), required=True); act.add_argument('--title', required=True); act.add_argument('--scope', choices=('job', 'batch')); act.add_argument('--note', default=''); act.add_argument('--restart-of'); act.add_argument('--resume-answer'); act.add_argument('--proof-file'); act.add_argument('--out', required=True)
    args = parser.parse_args()
    try: print(json.dumps({'request': request, 'load': load, 'report': report}[args.command](args), ensure_ascii=False))
    except (ValueError, KeyError, OSError, TypeError) as error: parser.exit(1, str(error) + '\n')

if __name__ == '__main__': main()
