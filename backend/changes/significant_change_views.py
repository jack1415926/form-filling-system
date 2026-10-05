from .review_access import readable_change
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChangeRequest, SignificantAssessment, SignificantChartResponse, SignificantQuestionResponse
from .significant_change import DEFINITION, CHART_IDS, QUESTION_IDS, F_VALUES, FINAL_VALUES, RESULT_VALUES


class StrictValues(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "填写内容必须是对象。"})
        errors = {key: "此字段不允许修改。" for key in set(data) - set(self.fields)}
        errors.update({key: "必须是文本。" for key, value in data.items() if key in self.fields and not isinstance(value, str)})
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(data)


class AssessmentValues(StrictValues):
    f_assessment = serializers.ChoiceField(choices=F_VALUES, required=False)
    final_conclusion = serializers.ChoiceField(choices=FINAL_VALUES, required=False)


class ChartValues(StrictValues):
    applicability = serializers.ChoiceField(choices=["", "Y", "N"], required=False)
    reason = serializers.CharField(allow_blank=True, trim_whitespace=False, required=False)
    result = serializers.ChoiceField(choices=RESULT_VALUES, required=False)

    def validate(self, values):
        key = self.context['key']
        if key == '0' and 'result' in values:
            raise serializers.ValidationError({'result': '第0项没有子表结论。'})
        allowed = ['', *[option['value'] for row in DEFINITION['charts'] if row['id'] == key for option in row['result_options']]]
        if 'result' in values and values['result'] not in allowed:
            raise serializers.ValidationError({'result': '该结论不适用于此 Chart。'})
        return values


class QuestionValues(StrictValues):
    answer = serializers.ChoiceField(choices=["", "Y", "N"], required=False)
    reason = serializers.CharField(allow_blank=True, trim_whitespace=False, required=False)


class SignificantChangeDetail(APIView):
    allow_review_read = True
    http_method_names = ['get', 'patch', 'head', 'options']

    @staticmethod
    def data(record):
        assessment = SignificantAssessment.objects.filter(change=record).first()
        charts = {row.chart_key: row for row in record.significant_charts.all()}
        questions = {row.question_key: row for row in record.significant_questions.all()}
        return {
            **DEFINITION, 'updated_at': record.updated_at.isoformat(),
            'assessment': {key: getattr(assessment, key, '') for key in ['f_assessment', 'final_conclusion']},
            'charts': [{**row, **{key: getattr(charts.get(row['id']), key, '') for key in ['applicability', 'reason', 'result']}} for row in DEFINITION['charts']],
            'questions': [{**row, **{key: getattr(questions.get(row['id']), key, '') for key in ['answer', 'reason']}} for row in DEFINITION['questions']],
        }

    def get(self, request, pk):
        with transaction.atomic():
            record = readable_change(request, pk)
            return Response(self.data(record))

    def patch(self, request, pk):
        with transaction.atomic():
            record = get_object_or_404(ChangeRequest.objects.select_for_update(), pk=pk, applicant=request.user)
            if record.status not in [ChangeRequest.Status.DRAFT, ChangeRequest.Status.RETURNED]:
                return Response({'detail': '申请已锁定，不能修改实质性变更评估。'}, status=409)
            data = request.data
            if not isinstance(data, dict):
                raise serializers.ValidationError({'detail': '请求内容必须是对象。'})
            forbidden = set(data) - {'assessment', 'charts', 'questions'}
            if forbidden:
                raise serializers.ValidationError({key: '此字段不允许修改。' for key in forbidden})
            staged = []
            errors = {}
            for section, model, serializer_type, id_field, ids in [
                ('assessment', SignificantAssessment, AssessmentValues, None, None),
                ('charts', SignificantChartResponse, ChartValues, 'chart_key', CHART_IDS),
                ('questions', SignificantQuestionResponse, QuestionValues, 'question_key', QUESTION_IDS),
            ]:
                if section not in data:
                    continue
                content = data[section]
                if not isinstance(content, dict):
                    errors[section] = {'detail': '填写内容必须是对象。'}
                    continue
                if id_field:
                    invalid = set(content) - set(ids)
                    if invalid:
                        errors[section] = {key: '标识不合法。' for key in invalid}
                        continue
                    existing = {getattr(row, id_field): row for row in model.objects.filter(change=record)}
                    entries = content.items()
                else:
                    existing = {None: model.objects.filter(change=record).first()}
                    entries = [(None, content)]
                section_errors = {}
                for key, values in entries:
                    instance = existing.get(key) or model(change=record, **({id_field: key} if id_field else {}))
                    serializer = serializer_type(data=values, context={'key': key})
                    if serializer.is_valid():
                        staged.append((instance, serializer.validated_data, list(serializer.fields)))
                    else:
                        section_errors[key] = serializer.errors
                if section_errors:
                    errors[section] = section_errors if id_field else section_errors[None]
            if errors:
                raise serializers.ValidationError(errors)
            changed = False
            for instance, values, fields in staged:
                if not any(getattr(instance, key) != value for key, value in values.items()):
                    continue
                changed = True
                for key, value in values.items():
                    setattr(instance, key, value)
                if any(getattr(instance, key) for key in fields):
                    instance.save()
                elif instance.pk:
                    instance.delete()
            if changed:
                record.updated_at = timezone.now()
                record.save(update_fields=['updated_at'])
            return Response(self.data(record))
