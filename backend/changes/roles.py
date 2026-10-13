FEEDBACK_ADMIN_GROUP = '反馈管理员'


def can_manage_feedback(user):
    return user.is_active and user.groups.filter(name=FEEDBACK_ADMIN_GROUP).exists()


def can_review(user):
    return user.is_active
