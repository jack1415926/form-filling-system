from rest_framework import serializers


class BusinessDateField(serializers.DateField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not 2000 <= value.year <= 2100:
            raise serializers.ValidationError("日期年份须在2000～2100年之间。")
        return value
