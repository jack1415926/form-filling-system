# 反馈管理是独立追加权限，不自动授予ECR/ECO查看、批准或发布权限。
FEEDBACK_ADMIN_GROUP = '反馈管理员'


def can_manage_feedback(user):
    return user.is_active and user.groups.filter(name=FEEDBACK_ADMIN_GROUP).exists()


def can_review(user):
    return user.is_active


def action_owner_references(user_ids):
    from .models import EcrActionResponse, EcoActionResponse
    return [row for model in [EcrActionResponse, EcoActionResponse]
            for row in model.objects.filter(owners__pk__in=user_ids).distinct()]
