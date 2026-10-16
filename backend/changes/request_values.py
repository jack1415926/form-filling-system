"""Shared request validation and conflict responses."""
import json

from rest_framework import serializers
from rest_framework.exceptions import APIException


def conflict(message):
    error = APIException(message)
    error.status_code = 409
    raise error


class StrictValues(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError('请求内容必须是对象。')
        extra = set(data) - set(self.fields)
        if extra:
            raise serializers.ValidationError({key: '此字段不允许修改。' for key in extra})
        for key, field in self.fields.items():
            if key in data and isinstance(field, serializers.IntegerField) and type(data[key]) is not int:
                raise serializers.ValidationError({key: '必须为整数。'})
            if key in data and isinstance(field, serializers.CharField) and not isinstance(data[key], str):
                raise serializers.ValidationError({key: '必须为文字。'})
        return super().to_internal_value(data)


def canonical(values):
    return json.loads(json.dumps(values, default=str))
