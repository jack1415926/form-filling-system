REVIEWER_GROUP = '审核员'
FEEDBACK_ADMIN_GROUP = '反馈管理员'


def can_manage_feedback(user):
    return user.is_active and user.groups.filter(name=FEEDBACK_ADMIN_GROUP).exists()


def business_role(user):
    return 'reviewer' if user.groups.filter(name=REVIEWER_GROUP).exists() else 'filler'
